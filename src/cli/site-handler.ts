/**
 * Per-site HTTP handler factories.
 *
 * Used by both the single-site commands (serve.ts / dev.ts) and the
 * MultisiteManager so the exact same request-handling logic runs regardless
 * of whether one site or many are active.
 */

import { render } from "preact-render-to-string";
import { join } from "@std/path";
import type { BootstrapResult } from "./bootstrap.ts";
import type { DuneEngine } from "../core/engine.ts";
import type { PageIndex } from "../content/types.ts";
import {
  withSecurityHeaders,
  maybeCompress,
  serveStaticFile,
  servePluginAsset,
  renderErrorPage,
  injectFeedLinks,
  injectLiveReload,
  injectRtlDir,
} from "./serve-utils.ts";
import { isRtl } from "../i18n/rtl.ts";
import {
  createPageCache,
  computeEtag,
  etagMatches,
  resolvePolicy,
  buildCacheControl,
} from "../cache/mod.ts";
import type { PageCache, ResolvedCachePolicy } from "../cache/mod.ts";
import { duneRoutes } from "../routing/routes.ts";
import { createApiHandler } from "../api/handlers.ts";
import { generateSitemap } from "../sitemap/generator.ts";
import { SITEMAP_XSL } from "../sitemap/stylesheet.ts";
import { detectHomeSlug } from "../content/index-builder.ts";
import {
  generateRss,
  generateAtom,
  type FeedItem,
  type FeedOptions,
} from "../feeds/generator.ts";
import { serveStagedPreview } from "../staging/preview.ts";
import type { MetricsCollector } from "../metrics/mod.ts";
import { isMediaFile } from "../content/path-utils.ts";

// ── Production ────────────────────────────────────────────────────────────────

/** Startup-time artifacts for a production site (computed once at boot). */
export interface SitePrebuilt {
  sitemapGzip: ArrayBuffer;
  rssFeed: string;
  atomFeed: string;
  feedEnabled: boolean;
  startTime: number;
}

/** Build startup-time artifacts (sitemap gzip + feeds). Call once per site. */
export async function buildSitePrebuilt(
  ctx: BootstrapResult,
  port: number,
): Promise<SitePrebuilt> {
  const { engine, config } = ctx;
  const startTime = Date.now();
  const feedEnabled = config.site.feed?.enabled !== false;

  // Pre-compress the sitemap so it stays well under reverse-proxy buffer limits
  // (OLS strips Accept-Encoding and Content-Length from backend responses,
  //  causing HTTP/1.1 proxying to truncate responses larger than ~88 KB).
  const siteUrl = engine.site.url || `http://localhost:${port}`;
  const homeSlug = config.site.home ?? detectHomeSlug(engine.pages);
  const sitemapXml = generateSitemap(engine.pages, {
    siteUrl,
    supportedLanguages: config.system.languages?.supported,
    defaultLanguage: config.system.languages?.default,
    includeDefaultInUrl: config.system.languages?.include_default_in_url,
    homeSlug,
    exclude: config.site.sitemap?.exclude,
    changefreqOverrides: config.site.sitemap?.changefreq,
  });
  const sitemapBytes = new TextEncoder().encode(sitemapXml);
  const sitemapGzip = await new Response(
    new Blob([sitemapBytes]).stream().pipeThrough(new CompressionStream("gzip")),
  ).arrayBuffer();

  let rssFeed = "";
  let atomFeed = "";
  if (feedEnabled) {
    const siteBase = engine.site.url?.replace(/\/$/, "") || `http://localhost:${port}`;
    const feedAuthor = engine.site.author
      ? { name: engine.site.author.name, email: engine.site.author.email }
      : undefined;
    const feedLang = config.system.languages?.default ?? "en";
    const feedCount = config.site.feed?.items ?? 20;
    const contentMode = config.site.feed?.content ?? "summary";

    const candidates = engine.pages
      .filter((p) => p.published && p.routable && p.date !== null)
      .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
      .slice(0, feedCount);

    const items: FeedItem[] = [];
    for (const pageIndex of candidates) {
      try {
        const result = await engine.resolve(pageIndex.route);
        if (result.type !== "page" || !result.page) continue;
        const page = result.page;
        const description = contentMode === "full"
          ? await page.html()
          : await page.summary();
        items.push({
          title: page.frontmatter.title || pageIndex.title,
          link: `${siteBase}${pageIndex.route}`,
          guid: `${siteBase}${pageIndex.route}`,
          pubDate: pageIndex.date ? new Date(pageIndex.date) : null,
          description,
        });
      } catch { /* skip pages that fail to load */ }
    }

    const baseFeedOpts: FeedOptions = {
      title: engine.site.title,
      description: engine.site.description || "",
      siteUrl: siteBase,
      feedUrl: `${siteBase}/feed.xml`,
      items,
      language: feedLang,
      author: feedAuthor,
    };
    rssFeed = generateRss(baseFeedOpts);
    atomFeed = generateAtom({ ...baseFeedOpts, feedUrl: `${siteBase}/atom.xml` });
  }

  return { sitemapGzip, rssFeed, atomFeed, feedEnabled, startTime };
}

/** Create the production HTTP handler for a single site. */
export function createProductionSiteHandler(
  ctx: BootstrapResult,
  prebuilt: SitePrebuilt,
  root: string,
  options: { port: number; debug?: boolean; metrics?: MetricsCollector },
): (req: Request) => Promise<Response> {
  const { debug = false, metrics } = options;
  const {
    engine, collections, taxonomy, search, imageHandler,
    adminHandler, flexEngine, pluginAssetDirs, stagingEngine, config,
    sharedThemesDir,
  } = ctx;
  const searchAnalyticsPath = join(
    config.admin?.runtimeDir ?? ".dune/admin",
    "search-analytics.jsonl",
  );
  const routes = duneRoutes(engine, collections, flexEngine, search, searchAnalyticsPath);
  const apiHandler = createApiHandler({ engine, collections, taxonomy, search, flex: flexEngine });
  const adminPrefix = config.admin?.path ?? "/admin";
  const siteName = engine.site.title;
  const { sitemapGzip, rssFeed, atomFeed, feedEnabled, startTime } = prebuilt;

  const renderJsx = (jsx: unknown, statusCode = 200) => {
    const html = render(jsx as Parameters<typeof render>[0]);
    return new Response(`<!DOCTYPE html>${html}`, {
      status: statusCode,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  };

  // ── HTTP caching setup ────────────────────────────────────────────────────

  const httpCacheConfig = config.site.http_cache ?? {};
  const cacheDefaults = {
    maxAge: httpCacheConfig.default_max_age ?? 0,
    swr: httpCacheConfig.default_swr ?? 60,
  };
  const cacheRules = httpCacheConfig.rules ?? [];

  const pageCacheConfig = config.system.page_cache;
  let pageCache: PageCache | null = null;
  if (pageCacheConfig?.enabled) {
    pageCache = createPageCache({
      maxEntries: pageCacheConfig.max_entries,
      ttl: pageCacheConfig.ttl,
    });
    // Cache warming: pre-render all pages in the background after startup.
    if (pageCacheConfig.warm) {
      // Fire-and-forget — don't block serving.
      Promise.resolve().then(() => warmPageCache(engine, pageCache!)).catch(() => {});
    }
  }

  // Attach page cache stats to the metrics collector when both are enabled.
  if (metrics && pageCache) {
    metrics.setPageCacheRef(() => pageCache!.stats());
  }

  // Helper: render a content response and optionally store it in the page cache.
  // Extracted to avoid duplicating cache-store logic across the if-else tree above.
  async function renderContentResponse(
    req: Request,
    url: URL,
    etag: string | null,
    policy: ResolvedCachePolicy,
    cacheControlValue: string,
  ): Promise<Response> {
    let contentResponse = await routes.contentHandler(req, renderJsx);
    if (feedEnabled) contentResponse = injectFeedLinks(siteName, contentResponse);

    // Inject dir="rtl" for RTL languages when the theme template hasn't already
    // set a dir= attribute on its <html> tag (safety net for legacy themes).
    const pageIndex = engine.pages.find((p) => p.route === url.pathname);
    const pageLang = pageIndex?.language ?? config.system.languages?.default ?? "en";
    contentResponse = injectRtlDir(
      contentResponse,
      isRtl(pageLang, config.system.languages?.rtl_override),
    );

    // Attach caching headers to successful HTML responses.
    if (contentResponse.status === 200 && etag) {
      const headers = new Headers(contentResponse.headers);
      headers.set("ETag", etag);
      headers.set("Cache-Control", cacheControlValue);
      contentResponse = new Response(contentResponse.body, { status: 200, headers });
    } else if (!policy.noStore && contentResponse.status === 200) {
      const headers = new Headers(contentResponse.headers);
      headers.set("Cache-Control", cacheControlValue);
      contentResponse = new Response(contentResponse.body, { status: 200, headers });
    }

    // Store in page cache when enabled (buffer body, then reconstruct response).
    if (pageCache && etag && contentResponse.status === 200) {
      const bodyBuffer = await contentResponse.arrayBuffer();
      pageCache.set(url.pathname, {
        body: new Uint8Array(bodyBuffer),
        etag,
        cacheControl: cacheControlValue,
      });
      contentResponse = new Response(bodyBuffer, {
        status: 200,
        headers: contentResponse.headers,
      });
    }

    return maybeCompress(req, withSecurityHeaders(contentResponse));
  }

  return async (req: Request): Promise<Response> => {
    const startMs = performance.now();
    const url = new URL(req.url);
    let response: Response = new Response("Internal Server Error", { status: 500 });
    try {
      // Health check
      if (url.pathname === "/health") {
        response = new Response(JSON.stringify({
          status: "ok",
          uptime: Math.floor((Date.now() - startTime) / 1000),
          pages: engine.pages.length,
          cache: pageCache ? pageCache.stats() : null,
        }), {
          headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
        });
      } else if (url.pathname === "/sitemap.xml") {
        // Sitemap — always serve pre-compressed to stay under proxy buffer limits
        response = new Response(sitemapGzip, {
          headers: {
            "Content-Type": "application/xml; charset=utf-8",
            "Content-Encoding": "gzip",
            "Content-Length": String(sitemapGzip.byteLength),
            "Cache-Control": "public, max-age=3600, must-revalidate",
            "Vary": "Accept-Encoding",
          },
        });
      } else if (url.pathname === "/sitemap.xsl") {
        response = new Response(SITEMAP_XSL, {
          headers: {
            "Content-Type": "text/xsl; charset=utf-8",
            "Cache-Control": "public, max-age=86400",
          },
        });
      } else if (feedEnabled && url.pathname === "/feed.xml") {
        // Feeds (pre-built at startup)
        response = await maybeCompress(req, new Response(rssFeed, {
          headers: {
            "Content-Type": "application/rss+xml; charset=utf-8",
            "Cache-Control": "public, max-age=3600, must-revalidate",
          },
        }));
      } else if (feedEnabled && url.pathname === "/atom.xml") {
        response = await maybeCompress(req, new Response(atomFeed, {
          headers: {
            "Content-Type": "application/atom+xml; charset=utf-8",
            "Cache-Control": "public, max-age=3600, must-revalidate",
          },
        }));
      } else if (/^\/(favicon\.(ico|svg)|robots\.txt)$/.test(url.pathname)) {
        // Root-level static assets (favicon, robots.txt)
        const staticResult = await serveStaticFile(root, url.pathname);
        response = withSecurityHeaders(
          staticResult ?? renderErrorPage(404, "Not Found", "The page you're looking for doesn't exist.", siteName),
        );
      } else if (url.pathname === "/__preview" && req.method === "GET") {
        // Staged draft preview
        const previewResult = await serveStagedPreview(url, engine, stagingEngine);
        response = previewResult ?? withSecurityHeaders(
          renderErrorPage(404, "Not Found", "Preview not found or token invalid.", siteName),
        );
      } else if (url.pathname.startsWith(adminPrefix)) {
        // Admin routes
        const adminResult = await adminHandler(req);
        response = withSecurityHeaders(
          adminResult ?? renderErrorPage(404, "Not Found", "The page you're looking for doesn't exist.", siteName),
        );
      } else if (url.pathname.startsWith("/api/")) {
        // API routes — admin handler first (covers /api/contact etc.), then core API
        const adminApiResult = await adminHandler(req);
        if (adminApiResult) {
          response = adminApiResult;
        } else {
          const apiResult = await apiHandler(req);
          response = apiResult ?? new Response(
            JSON.stringify({ error: "Not found" }),
            { status: 404, headers: { "Content-Type": "application/json" } },
          );
        }
      } else if (url.pathname.startsWith("/static/") || url.pathname.startsWith("/themes/")) {
        // Theme / site static files
        const staticResult = await serveStaticFile(root, url.pathname, false, sharedThemesDir);
        response = staticResult ?? withSecurityHeaders(
          renderErrorPage(404, "Not Found", "The page you're looking for doesn't exist.", siteName),
        );
      } else if (url.pathname.startsWith("/plugins/")) {
        // Plugin assets
        const pluginAssetResponse = await servePluginAsset(pluginAssetDirs, url.pathname);
        response = pluginAssetResponse
          ? withSecurityHeaders(pluginAssetResponse)
          : withSecurityHeaders(
              renderErrorPage(404, "Not Found", "The page you're looking for doesn't exist.", siteName),
            );
      } else if (url.pathname.startsWith("/content-media/")) {
        // Legacy /content-media/* path — kept for backward compat
        const imageResult = await imageHandler(req);
        response = imageResult ?? await routes.mediaHandler(req);
      } else {
        // Stat-first: if the URL ends in a known media extension, check for
        // a co-located content file before routing to the page handler.
        const lastSegment = url.pathname.split("/").pop() ?? "";
        let mediaServed = false;
        if (lastSegment && isMediaFile(lastSegment)) {
          const mediaPath = url.pathname.slice(1); // strip leading /
          const media = await engine.serveMedia(mediaPath);
          if (media) {
            const imageResult = await imageHandler(req);
            response = imageResult ?? new Response(media.data as BodyInit, {
              headers: {
                "Content-Type": media.contentType,
                "Content-Length": String(media.size),
                "Cache-Control": "public, max-age=3600",
              },
            });
            mediaServed = true;
          }
        }

        if (!mediaServed) {
          // ── Content routes ────────────────────────────────────────────────
          // 1. Compute ETag from PageIndex (fast — no file I/O).
          // 2. Check page cache (optional in-process cache).
          // 3. Handle If-None-Match → 304.
          // 4. Render and add Cache-Control + ETag headers.
          // 5. Store rendered HTML in page cache when enabled.
          const pageIndex = engine.pages.find((p) => p.route === url.pathname);
          const etag = pageIndex ? await computeEtag(pageIndex) : null;
          const policy = resolvePolicy(url.pathname, cacheRules, cacheDefaults);
          const cacheControlValue = buildCacheControl(policy);

          // Check in-process cache before rendering.
          if (pageCache && etag) {
            const cached = pageCache.get(url.pathname);
            if (cached && cached.etag === etag) {
              if (etagMatches(req.headers.get("If-None-Match"), etag)) {
                response = new Response(null, {
                  status: 304,
                  headers: { "ETag": etag, "Cache-Control": cacheControlValue },
                });
              } else {
                response = await maybeCompress(
                  req,
                  withSecurityHeaders(new Response(cached.body as BodyInit, {
                    status: 200,
                    headers: {
                      "Content-Type": "text/html; charset=utf-8",
                      "ETag": etag,
                      "Cache-Control": cacheControlValue,
                    },
                  })),
                );
              }
            } else {
              response = await renderContentResponse(req, url, etag, policy, cacheControlValue);
            }
          } else if (etag && etagMatches(req.headers.get("If-None-Match"), etag)) {
            // 304 via If-None-Match even without the page cache (browser / CDN revalidation).
            response = new Response(null, {
              status: 304,
              headers: { "ETag": etag, "Cache-Control": cacheControlValue },
            });
          } else {
            response = await renderContentResponse(req, url, etag, policy, cacheControlValue);
          }
          // ──────────────────────────────────────────────────────────────────
        }
      }
    } catch (err) {
      if (debug) {
        console.error(`✗ Error serving ${url.pathname}:`, err);
      } else {
        console.error(`✗ Error serving ${url.pathname}: ${(err as Error).message ?? err}`);
      }
      response = withSecurityHeaders(
        renderErrorPage(500, "Server Error", "Something went wrong. Please try again later.", siteName),
      );
    }

    metrics?.recordRequest(url.pathname, performance.now() - startMs, response.status >= 500);
    return response;
  };
}

// ── Dev ───────────────────────────────────────────────────────────────────────

/** Dev-mode site context returned by createDevSiteContext. */
export interface DevSiteContext {
  /** HTTP request handler — pass to Deno.serve or MultisiteManager. */
  handler: (req: Request) => Promise<Response>;
  /** Signal all connected SSE clients to reload (call after a successful rebuild). */
  notifyReload: () => void;
  /** Clear the SSE client set — call when tearing down the site in multi-site mode. */
  cleanup: () => void;
}

/**
 * Create the dev-mode HTTP handler + SSE infrastructure for one site.
 * File watching is NOT set up here — the caller (dev.ts or MultisiteManager)
 * is responsible for calling `notifyReload()` after each rebuild.
 */
export function createDevSiteContext(
  ctx: BootstrapResult,
  root: string,
  options: { port: number; debug?: boolean },
): DevSiteContext {
  const { port, debug = false } = options;
  const {
    engine, collections, taxonomy, search, imageHandler,
    adminHandler, flexEngine, pluginAssetDirs, stagingEngine, config,
    sharedThemesDir,
  } = ctx;
  const searchAnalyticsPath = join(
    config.admin?.runtimeDir ?? ".dune/admin",
    "search-analytics.jsonl",
  );
  const routes = duneRoutes(engine, collections, flexEngine, search, searchAnalyticsPath);
  const apiHandler = createApiHandler({ engine, collections, taxonomy, search, flex: flexEngine });
  const adminPrefix = config.admin?.path ?? "/admin";
  const feedEnabled = config.site.feed?.enabled !== false;

  const renderJsx = (jsx: unknown, statusCode = 200) => {
    const html = render(jsx as Parameters<typeof render>[0]);
    return new Response(`<!DOCTYPE html>${html}`, {
      status: statusCode,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  };

  // SSE state — one Set of controllers per site instance
  const sseClients = new Set<ReadableStreamDefaultController<Uint8Array>>();

  function notifyReload(): void {
    const message = new TextEncoder().encode("data: reload\n\n");
    for (const controller of sseClients) {
      try {
        controller.enqueue(message);
      } catch {
        sseClients.delete(controller);
      }
    }
  }

  function handleSSE(): Response {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        sseClients.add(controller);
        controller.enqueue(new TextEncoder().encode(": connected\n\n"));
      },
      cancel() { /* client disconnected — no explicit cleanup needed */ },
    });
    return new Response(body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  /** Build feed items on demand (used each request in dev mode). */
  async function buildFeedItems(): Promise<FeedItem[]> {
    const feedConfig = config.site.feed;
    const count = feedConfig?.items ?? 20;
    const contentMode = feedConfig?.content ?? "summary";
    const siteBase = config.site.url?.replace(/\/$/, "") || `http://localhost:${port}`;

    const candidates = engine.pages
      .filter((p) => p.published && p.routable && p.date !== null)
      .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
      .slice(0, count);

    const items: FeedItem[] = [];
    for (const pageIndex of candidates) {
      try {
        const result = await engine.resolve(pageIndex.route);
        if (result.type !== "page" || !result.page) continue;
        const page = result.page;
        const description = contentMode === "full"
          ? await page.html()
          : await page.summary();
        items.push({
          title: page.frontmatter.title || pageIndex.title,
          link: `${siteBase}${pageIndex.route}`,
          guid: `${siteBase}${pageIndex.route}`,
          pubDate: pageIndex.date ? new Date(pageIndex.date) : null,
          description,
        });
      } catch { /* skip */ }
    }
    return items;
  }

  const handler = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const startPerf = performance.now();
    let response: Response = new Response("Internal Server Error", { status: 500 });

    try {
      if (url.pathname === "/__dune_reload") {
        return handleSSE();
      } else if (url.pathname === "/__preview" && req.method === "GET") {
        const previewResult = await serveStagedPreview(url, engine, stagingEngine);
        response = previewResult ?? new Response("Preview not found or token invalid.", { status: 404 });
      } else if (url.pathname.startsWith(adminPrefix)) {
        const adminResult = await adminHandler(req);
        response = adminResult ?? new Response("Not found", { status: 404 });
      } else if (url.pathname.startsWith("/api/")) {
        const adminApiResult = await adminHandler(req);
        response = adminApiResult ??
          await apiHandler(req) ??
          new Response(JSON.stringify({ error: "Not found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          });
      } else if (feedEnabled && (url.pathname === "/feed.xml" || url.pathname === "/atom.xml")) {
        const items = await buildFeedItems();
        const siteBase = config.site.url?.replace(/\/$/, "") || `http://localhost:${port}`;
        const feedOpts: FeedOptions = {
          title: engine.site.title,
          description: engine.site.description || "",
          siteUrl: siteBase,
          feedUrl: `${siteBase}${url.pathname}`,
          items,
          language: config.system.languages?.default ?? "en",
          author: engine.site.author
            ? { name: engine.site.author.name, email: engine.site.author.email }
            : undefined,
        };
        const feedXml = url.pathname === "/feed.xml"
          ? generateRss(feedOpts)
          : generateAtom(feedOpts);
        const feedContentType = url.pathname === "/feed.xml"
          ? "application/rss+xml; charset=utf-8"
          : "application/atom+xml; charset=utf-8";
        response = new Response(feedXml, {
          headers: { "Content-Type": feedContentType, "Cache-Control": "no-cache" },
        });
      } else if (url.pathname === "/sitemap.xsl") {
        response = new Response(SITEMAP_XSL, {
          headers: { "Content-Type": "text/xsl; charset=utf-8", "Cache-Control": "no-cache" },
        });
      } else if (url.pathname === "/sitemap.xml") {
        const siteUrl = config.site.url || `http://localhost:${port}`;
        const homeSlug = config.site.home ?? detectHomeSlug(engine.pages);
        const sitemapXml = generateSitemap(engine.pages, {
          siteUrl,
          supportedLanguages: config.system.languages?.supported,
          defaultLanguage: config.system.languages?.default,
          includeDefaultInUrl: config.system.languages?.include_default_in_url,
          homeSlug,
          exclude: config.site.sitemap?.exclude,
          changefreqOverrides: config.site.sitemap?.changefreq,
        });
        response = new Response(sitemapXml, {
          headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-cache" },
        });
      } else if (/^\/(favicon\.(ico|svg)|robots\.txt)$/.test(url.pathname)) {
        response = await serveStaticFile(root, url.pathname, true) ??
          new Response("Not found", { status: 404 });
      } else if (url.pathname.startsWith("/static/") || url.pathname.startsWith("/themes/")) {
        response = await serveStaticFile(root, url.pathname, true, sharedThemesDir) ??
          new Response("Not found", { status: 404 });
      } else if (url.pathname.startsWith("/plugins/")) {
        response = await servePluginAsset(pluginAssetDirs, url.pathname, true) ??
          new Response("Not found", { status: 404 });
      } else if (url.pathname.startsWith("/content-media/")) {
        const imageResult = await imageHandler(req);
        response = imageResult ?? await routes.mediaHandler(req);
      } else {
        // Stat-first: if the URL ends in a known media extension, check for
        // a co-located content file before routing to the page handler.
        const lastSegment = url.pathname.split("/").pop() ?? "";
        let devMediaServed = false;
        if (lastSegment && isMediaFile(lastSegment)) {
          const mediaPath = url.pathname.slice(1); // strip leading /
          const media = await engine.serveMedia(mediaPath);
          if (media) {
            const imageResult = await imageHandler(req);
            response = imageResult ?? new Response(media.data as BodyInit, {
              headers: {
                "Content-Type": media.contentType,
                "Content-Length": String(media.size),
                "Cache-Control": "public, max-age=3600",
              },
            });
            devMediaServed = true;
          }
        }
        if (!devMediaServed) {
          response = await routes.contentHandler(req, renderJsx);
        }
      }

      // Inject feed links + live-reload script + RTL direction into HTML
      // (skip admin and API paths).
      if (!url.pathname.startsWith(adminPrefix) && !url.pathname.startsWith("/api/")) {
        if (feedEnabled) response = injectFeedLinks(engine.site.title, response);
        // RTL injection: add dir="rtl" when the page language is RTL and the
        // theme template hasn't already set a dir= on the <html> tag.
        const devPageIndex = engine.pages.find((p) => p.route === url.pathname);
        const devPageLang = devPageIndex?.language ?? config.system.languages?.default ?? "en";
        response = injectRtlDir(
          response,
          isRtl(devPageLang, config.system.languages?.rtl_override),
        );
        response = injectLiveReload(response);
      }
    } catch (err) {
      console.error(`  ✗ Error: ${err}`);
      response = new Response("Internal Server Error", { status: 500 });
    }

    if (debug) {
      const elapsed = (performance.now() - startPerf).toFixed(0);
      console.log(`  ${response.status} ${url.pathname} (${elapsed}ms)`);
    }

    return response;
  };

  return {
    handler,
    notifyReload,
    cleanup: () => sseClients.clear(),
  };
}

// ─── Cache warming ────────────────────────────────────────────────────────────

/**
 * Pre-render all published routable pages in the background to warm the
 * in-process page cache.  Runs after server startup — fire-and-forget.
 * Individual page failures are silently ignored so one broken page doesn't
 * abort the warm-up of the rest.
 */
async function warmPageCache(engine: DuneEngine, cache: PageCache): Promise<void> {
  const routes = engine.pages
    .filter((p: PageIndex) => p.published && p.routable)
    .map((p: PageIndex) => p.route);

  // Pre-resolve pages so their content is loaded and the ETag can be computed.
  // The page-loader uses lazyOnce() internally, so this effectively pre-warms
  // both the page-loading cache and — because the handler checks the cache after
  // rendering — the HTML cache on the first real request to each route.
  const CONCURRENCY = 8;
  for (let i = 0; i < routes.length; i += CONCURRENCY) {
    await Promise.all(
      routes.slice(i, i + CONCURRENCY).map(async (route) => {
        try {
          await engine.resolve(route);
        } catch { /* skip broken pages */ }
      }),
    );
  }
  void cache; // suppress unused-variable lint — cache is populated by real requests
}
