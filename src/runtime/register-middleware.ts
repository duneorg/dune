import type { App } from "fresh";
import type { BootstrapResult } from "./bootstrap.ts";
import type { HttpCacheRule } from "../config/types.ts";
import type { PageCache } from "../cache/mod.ts";
import { isMediaFile } from "../content/path-utils.ts";
import {
  maybeCompress,
  withSecurityHeaders,
  renderErrorPage,
  injectFeedLinks,
  injectLiveReload,
  injectRtlDir,
} from "../cli/serve-utils.ts";
import { hasAdminSessionCookie } from "../cli/admin-bar-inject.ts";
import { runPluginResponseTransforms } from "../cli/response-transforms.ts";
import {
  computeEtag,
  etagMatches,
  resolvePolicy,
  buildCacheControl,
} from "../cache/mod.ts";
import { isRtl } from "../i18n/rtl.ts";

type RenderJsx = (jsx: unknown, status?: number) => Promise<Response>;

interface DuneRoutes {
  contentHandler(req: Request, render: RenderJsx): Promise<Response>;
}

export interface ContentMiddlewareOptions {
  dev: boolean;
  debug: boolean;
  pageCache: PageCache | null;
  transformFingerprint: string;
  cacheRules: HttpCacheRule[];
  cacheDefaults: { maxAge: number; swr: number };
  feedEnabled: boolean;
  siteName: string;
  adminPrefix: string;
  routes: DuneRoutes;
}

function makeRenderJsx(render: (vnode: unknown) => Response | Promise<Response>): RenderJsx {
  return async (jsx: unknown, statusCode = 200): Promise<Response> => {
    const res = await render(jsx);
    if (statusCode === 200) return res;
    return new Response(res.body, { status: statusCode, headers: res.headers });
  };
}

/** Truncate and strip control characters before writing to a log. Prevents CRLF injection (LOW-4). */
function sanitizeForLog(s: string): string {
  if (typeof s !== "string") return String(s);
  // deno-lint-ignore no-control-regex -- stripping control chars is the intent
  let cleaned = s.replace(/[\x00-\x1f\x7f]/g, "?");
  if (cleaned.length > 256) cleaned = cleaned.slice(0, 256) + "…";
  return cleaned;
}

/**
 * Register the content catch-all (app.all("/*")) with ETag revalidation, in-process
 * page cache, compression, RTL injection, admin bar, and plugin response transforms.
 */
export function registerContentCatchAll(
  // deno-lint-ignore no-explicit-any
  app: App<any>,
  ctx: BootstrapResult,
  opts: ContentMiddlewareOptions,
): void {
  const { dev, debug, pageCache, transformFingerprint, cacheRules, cacheDefaults, feedEnabled, siteName, adminPrefix, routes } = opts;
  const { engine, imageHandler, hooks, config, metrics } = ctx;
  // deno-lint-ignore no-explicit-any
  const getAdminAuth = () => (ctx.adminContext as any)?.auth ?? null;

  app.all("/*", async (fc) => {
    const startMs = performance.now();
    const { url, req } = fc;
    let response: Response;

    try {
      // Serve co-located media before routing to the content handler.
      const lastSegment = url.pathname.split("/").pop() ?? "";
      if (lastSegment && isMediaFile(lastSegment)) {
        const mediaPath = url.pathname.slice(1);
        const media = await engine.serveMedia(mediaPath);
        if (media) {
          const imageResult = await imageHandler(req);
          if (imageResult) {
            response = imageResult;
          } else {
            const headers: Record<string, string> = {
              "Content-Type": media.contentType,
              "Content-Length": String(media.size),
              "Cache-Control": "public, max-age=3600",
              "X-Content-Type-Options": "nosniff",
            };
            // Sandbox HTML/SVG media so user-uploaded content can't read
            // admin cookies or hit same-origin endpoints. See HIGH-12, HIGH-13.
            if (
              media.contentType.includes("text/html") ||
              media.contentType.includes("image/svg+xml")
            ) {
              headers["Content-Security-Policy"] = "sandbox allow-scripts allow-popups";
              headers["X-Frame-Options"] = "SAMEORIGIN";
            }
            response = new Response(media.data as BodyInit, { headers });
          }
          metrics?.recordRequest(url.pathname, performance.now() - startMs, response.status >= 500);
          return response;
        }
      }

      const renderJsx = makeRenderJsx((vnode) => fc.render(vnode as Parameters<typeof fc.render>[0]));

      if (!dev) {
        const pageIndex = engine.pages.find((p) => p.route === url.pathname);
        const etag = pageIndex ? await computeEtag(pageIndex, transformFingerprint) : null;
        const policy = resolvePolicy(url.pathname, cacheRules, cacheDefaults);
        const ccValue = buildCacheControl(policy);

        // Admin-session requests bypass the shared page cache (their response
        // includes the injected admin bar and must never be stored anonymously).
        const bypassPageCache = hasAdminSessionCookie(req);

        // Page cache hit
        if (pageCache && etag && !bypassPageCache) {
          const cached = pageCache.get(url.pathname);
          if (cached?.etag === etag) {
            if (etagMatches(req.headers.get("If-None-Match"), etag)) {
              response = new Response(null, {
                status: 304,
                headers: { "ETag": etag, "Cache-Control": ccValue },
              });
            } else {
              response = await maybeCompress(
                req,
                withSecurityHeaders(new Response(cached.body as BodyInit, {
                  status: 200,
                  headers: {
                    "Content-Type": "text/html; charset=utf-8",
                    "ETag": etag,
                    "Cache-Control": ccValue,
                  },
                })),
              );
            }
            metrics?.recordRequest(url.pathname, performance.now() - startMs, false);
            return response;
          }
        }

        // Browser ETag revalidation (skipped for admin-session requests).
        if (etag && !bypassPageCache && etagMatches(req.headers.get("If-None-Match"), etag)) {
          response = new Response(null, {
            status: 304,
            headers: { "ETag": etag, "Cache-Control": ccValue },
          });
          metrics?.recordRequest(url.pathname, performance.now() - startMs, false);
          return response;
        }

        response = await routes.contentHandler(req, renderJsx);
        if (feedEnabled) response = injectFeedLinks(siteName, response);

        // Plugin response transforms (e.g. admin bar injection) — must run before caching.
        response = await runPluginResponseTransforms({
          req,
          response,
          plugins: hooks.plugins(),
          auth: getAdminAuth(),
          pages: engine.pages,
          config,
          adminPrefix,
        });

        // RTL direction injection
        const rtlSupportedLangs = config.system.languages?.supported ?? [];
        const rtlUrlSegments = url.pathname.split("/");
        const pageLang =
          rtlSupportedLangs.length > 1 && rtlSupportedLangs.includes(rtlUrlSegments[1])
            ? rtlUrlSegments[1]
            : (config.system.languages?.default ?? "en");
        response = injectRtlDir(response, isRtl(pageLang, config.system.languages?.rtl_override));

        // Cache headers. Admin responses get private/no-store so CDNs/browsers
        // never revalidate a bar-injected body against the anonymous variant.
        if (bypassPageCache && response.status === 200) {
          const h = new Headers(response.headers);
          h.set("Cache-Control", "private, no-store");
          response = new Response(response.body, { status: 200, headers: h });
        } else if (etag && response.status === 200) {
          const h = new Headers(response.headers);
          h.set("ETag", etag);
          h.set("Cache-Control", ccValue);
          response = new Response(response.body, { status: 200, headers: h });
        } else if (response.status === 200) {
          const h = new Headers(response.headers);
          h.set("Cache-Control", ccValue);
          response = new Response(response.body, { status: 200, headers: h });
        }

        // Store in page cache (never for admin-session responses).
        if (pageCache && etag && !bypassPageCache && response.status === 200) {
          const body = await response.arrayBuffer();
          pageCache.set(url.pathname, {
            body: new Uint8Array(body),
            etag,
            cacheControl: ccValue,
          });
          response = new Response(body, { status: 200, headers: response.headers });
        }

        response = await maybeCompress(req, withSecurityHeaders(response));
      } else {
        // Dev mode: no cache, inject live reload + feed links
        response = await routes.contentHandler(req, renderJsx);
        if (response.status === 200) {
          const h = new Headers(response.headers);
          h.set("Cache-Control", "no-store");
          response = new Response(response.body, { status: 200, headers: h });
        }
        if (feedEnabled) response = injectFeedLinks(siteName, response);

        response = await runPluginResponseTransforms({
          req,
          response,
          plugins: hooks.plugins(),
          auth: getAdminAuth(),
          pages: engine.pages,
          config,
          adminPrefix,
        });

        const devSupportedLangs = config.system.languages?.supported ?? [];
        const devUrlSegments = url.pathname.split("/");
        const devLang =
          devSupportedLangs.length > 1 && devSupportedLangs.includes(devUrlSegments[1])
            ? devUrlSegments[1]
            : (config.system.languages?.default ?? "en");
        response = injectRtlDir(response, isRtl(devLang, config.system.languages?.rtl_override));
        response = injectLiveReload(response);
      }
    } catch (err) {
      const safePath = sanitizeForLog(url.pathname);
      if (debug) {
        console.error(`✗ Error serving ${safePath}:`, err);
      } else {
        console.error(`✗ Error serving ${safePath}: ${(err as Error).message ?? err}`);
      }
      response = withSecurityHeaders(
        renderErrorPage(500, "Server Error", "Something went wrong. Please try again later.", siteName),
      );
    }

    metrics?.recordRequest(url.pathname, performance.now() - startMs, response.status >= 500);
    return response;
  });
}
