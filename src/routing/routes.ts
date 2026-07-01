/**
 * Fresh route registration — hooks the DuneEngine into Fresh 2.
 *
 * Registers:
 *   - /content-media/* → co-located media serving
 *   - /api/* → REST API endpoints (basic for v0.1)
 *   - /* → catch-all content route (must be last)
 *
 * Per PRD §7.1, template resolution is format-aware:
 *   - .md pages → rendered HTML injected into theme template
 *   - .tsx pages → component renders itself, optionally wrapped in layout
 */

/** @jsxImportSource preact */
import { h, type ComponentType } from "preact";
import type { DuneEngine } from "../core/engine.ts";
import type { Page, TemplateComponent, TemplateProps } from "../content/types.ts";
import { directionOf } from "../i18n/rtl.ts";
import type { CollectionEngine } from "../collections/engine.ts";
import type { FlexEngine } from "../flex/engine.ts";
import type { SearchEngine } from "../search/engine.ts";
import { generateSearchPage } from "../search/page.ts";
import { RateLimiter, clientIp } from "../security/rate-limit.ts";
import { parseRolesSpec, enforceRolesFromRequest } from "../auth/gating.ts";
import { logger, generateRequestId } from "../core/logger.ts";
import { tracer } from "../tracing/mod.ts";
import { handleFlexRoute } from "./flex-handler.ts";
import { handleTsxPage } from "./tsx-handler.ts";
import { handleMarkdownPage } from "./content-handler.ts";

export type { FlexListTemplateProps, FlexDetailTemplateProps } from "./flex-handler.ts";

// Per-IP rate limit for public read endpoints (120 req/min).
const publicRateLimiter = new RateLimiter(120, 60 * 1000);

/**
 * Register all Dune routes on a Fresh App.
 * Returns a function that takes the app and returns it with routes added.
 */
export interface DuneRoutes {
  mediaHandler(req: Request): Promise<Response>;
  /** Handles /_dune/* system introspection endpoints. */
  systemHandler(req: Request): Promise<Response>;
  contentHandler(req: Request, renderJsx: (jsx: unknown, status?: number) => Response | Promise<Response>): Promise<Response>;
}

/**
 * Build the Fresh route handler array for a Dune site.
 *
 * Returns routes for: content pages, media files, image processing,
 * search, sitemaps, and optional analytics tracking.
 * Pass the returned array to Fresh's `defineConfig({ plugins: [freshPluginDune(routes)] })`
 * or register each route directly with your Fresh app.
 */
export function duneRoutes(
  engine: DuneEngine,
  collections?: CollectionEngine,
  flex?: FlexEngine,
  search?: SearchEngine,
): DuneRoutes {
  return {
    /**
     * Register media serving route.
     */
    mediaHandler: async (req: Request): Promise<Response> => {
      const url = new URL(req.url);
      // Strip /content-media/ prefix
      const mediaPath = url.pathname.replace(/^\/content-media\//, "");

      const media = await engine.serveMedia(mediaPath);
      if (!media) {
        return new Response("Not found", { status: 404 });
      }

      // Uint8Array<ArrayBufferLike> is a valid BodyInit at runtime, but
      // TypeScript 5.7's generic typed-array signature requires an explicit
      // cast here.  A single cast (not double `as unknown as BodyInit`) is
      // sufficient and documents the intent clearly.
      const headers: Record<string, string> = {
        "Content-Type": media.contentType,
        "Content-Length": String(media.size),
        "Cache-Control": "public, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      };
      // .html and .svg media are user-uploadable and execute as documents
      // when navigated to directly. Serve them under a sandbox CSP so any
      // embedded JS runs in an opaque origin — it can't read admin cookies
      // or hit same-origin endpoints. allow-scripts keeps the auto-height
      // postMessage feature working for legitimate co-located iframes.
      if (
        media.contentType.includes("text/html") ||
        media.contentType.includes("image/svg+xml")
      ) {
        headers["Content-Security-Policy"] = "sandbox allow-scripts allow-popups";
        headers["X-Frame-Options"] = "SAMEORIGIN";
      }
      return new Response(media.data as BodyInit, { headers });
    },

    /**
     * System introspection endpoints — /_dune/*.
     * All responses are JSON. No authentication required (read-only metadata).
     */
    systemHandler: async (req: Request): Promise<Response> => {
      const url = new URL(req.url);
      const path = url.pathname;

      // GET /_dune/schema/config — JSON Schema for site.yaml
      if (path === "/_dune/schema/config") {
        const { CONFIG_SCHEMA, SCHEMA_VERSION } = await import("../schema/config-schema.ts");
        return Response.json(
          { schemaVersion: SCHEMA_VERSION, schema: CONFIG_SCHEMA },
          { headers: { "Cache-Control": "public, max-age=86400" } },
        );
      }

      return Response.json({ error: "Not found" }, { status: 404 });
    },

    /**
     * Catch-all content handler — thin dispatcher.
     * Resolves URL → page type → delegates to the appropriate sub-handler.
     */
    contentHandler: async (
      req: Request,
      renderJsx: (jsx: unknown, status?: number) => Response | Promise<Response>,
    ): Promise<Response> => {
      const url = new URL(req.url);
      const reqLog = logger.child({ requestId: generateRequestId(), pathname: url.pathname });
      reqLog.debug("request.start", { method: req.method });

      const span = tracer.startSpan("http.request", { pathname: url.pathname });

      const respond = async (r: Response | Promise<Response>): Promise<Response> => {
        const res = await r;
        span.setAttribute("status", res.status);
        span.end();
        return res;
      };

      // ── Search route ──────────────────────────────────────────────────────
      if (url.pathname === "/search") {
        const ip = clientIp(req);
        if (!publicRateLimiter.check(ip)) {
          return respond(new Response("Too many requests", {
            status: 429,
            headers: { "Retry-After": String(publicRateLimiter.retryAfter(ip)) },
          }));
        }
        const q = url.searchParams.get("q") ?? "";
        const rawResults = search ? await search.search(q, 20) : [];
        const results = rawResults.map((r) => ({
          route: r.page.route,
          title: r.page.title,
          excerpt: r.excerpt,
          score: r.score,
        }));

        const searchTemplate = await engine.themes.loadTemplate("search");
        if (searchTemplate) {
          const layout = await engine.themes.loadLayout("layout");
          const strings = await engine.themes.loadLocale("en");
          const t = (key: string) => (strings[key] ?? key) as string;
          return respond(renderJsx(
            h(searchTemplate.component as ComponentType<any>, {
              page: null,
              pageTitle: `Search${q ? `: ${q}` : ""} | ${engine.site.title}`,
              site: engine.site,
              config: engine.config,
              nav: engine.router.getTopNavigation("en"),
              pathname: url.pathname,
              search: url.search,
              Layout: layout ?? undefined,
              themeConfig: engine.themeConfig,
              t,
              searchQuery: q,
              searchResults: results,
              dir: directionOf("en", engine.config?.system?.languages?.rtl_override),
            }),
          ));
        }

        const html = generateSearchPage({
          query: q,
          results,
          site: engine.site,
          siteUrl: engine.site.url || "",
        });
        return respond(new Response(html, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        }));
      }
      // ─────────────────────────────────────────────────────────────────────

      // ── Flex object public routes ─────────────────────────────────────────
      if (flex && url.pathname.startsWith("/flex/")) {
        return respond(handleFlexRoute(engine, url, flex, renderJsx));
      }
      // ─────────────────────────────────────────────────────────────────────

      const result = await engine.resolve(url.pathname);

      // Redirects
      if (result.type === "redirect" && result.redirectTo) {
        return respond(Response.redirect(
          new URL(result.redirectTo, url.origin).toString(),
          301,
        ));
      }

      // Not found — render 404 through theme if available
      if (result.type === "not-found" || !result.page) {
        const Layout = await engine.themes.loadLayout("layout");
        const siteData = engine.site;
        const defaultLang = engine.config?.system?.languages?.default ?? "en";
        const navData = engine.router.getTopNavigation(defaultLang);
        if (Layout) {
          const fakePage = {
            route: url.pathname,
            template: "layout",
            frontmatter: { title: "404 — Not Found" },
            language: defaultLang,
          } as unknown as Page;
          return respond(renderJsx(
            h(Layout as unknown as ComponentType<TemplateProps>, {
              site: siteData,
              page: fakePage,
              nav: navData,
              pageTitle: "404 — Not Found",
              config: engine.config,
              dir: directionOf(defaultLang),
            },
              h("div", { class: "content-page" },
                h("div", { style: "text-align: center; max-width: 600px; margin: 4rem auto; padding: 2rem;" },
                  h("h1", null, "404"),
                  h("p", null, "Page not found."),
                  h("a", { href: "/" }, "← Go home"),
                ),
              ),
            ),
            404,
          ));
        }
        return respond(renderJsx(
          h("html", null,
            h("head", null,
              h("title", null, "404 — Not Found"),
              h("meta", { charset: "utf-8" }),
              h("meta", { name: "viewport", content: "width=device-width, initial-scale=1" }),
              h("style", null, `
                body { font-family: system-ui, sans-serif; max-width: 600px; margin: 4rem auto; padding: 0 1rem; color: #333; }
                h1 { font-size: 3rem; margin-bottom: 0.5rem; }
                p { color: #666; }
                a { color: #0066cc; }
              `),
            ),
            h("body", null,
              h("h1", null, "404"),
              h("p", null, "Page not found: ", url.pathname),
              h("a", { href: "/" }, "← Go home"),
            ),
          ),
          404,
        ));
      }

      const page = result.page;

      // ── Role-based content gating ───────────────────────────────────────────
      {
        const rolesSpec = parseRolesSpec(page.frontmatter.roles);
        if (rolesSpec !== null) {
          const gateResponse = await enforceRolesFromRequest(req, rolesSpec);
          if (gateResponse !== null) return respond(gateResponse);
        }
      }
      // ───────────────────────────────────────────────────────────────────────

      if (page.format === "tsx") {
        return respond(handleTsxPage(engine, req, url, page, renderJsx));
      }

      return respond(handleMarkdownPage(engine, url, page, collections, renderJsx));
    },
  };
}
