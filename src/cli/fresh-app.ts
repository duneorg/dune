/**
 * fresh-app.ts — assembles a Fresh App with Dune as middleware.
 *
 * This is the correct integration point: Fresh owns the server and request
 * lifecycle; Dune's content routing, admin panel, plugin hooks, and static
 * file serving are registered as Fresh routes and middleware.
 *
 * Used by serve.ts (production) and dev.ts (development).
 * Multisite and SSG continue using site-handler.ts directly.
 */

import { App, staticFiles } from "fresh";
import type { AdminState } from "../admin/types.ts";
import { join } from "@std/path";
import type { BootstrapResult } from "./bootstrap.ts";
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
import { duneRoutes } from "../routing/routes.ts";
import { createApiHandler } from "../api/handlers.ts";
import {
  handleContactSubmission,
  handleFormSchema,
  handleFormSubmission,
  handleIncomingWebhook,
} from "../admin/public-api.ts";
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
import { isMediaFile } from "../content/path-utils.ts";
import {
  createPageCache,
  computeEtag,
  etagMatches,
  resolvePolicy,
  buildCacheControl,
  type PageCache,
} from "../cache/mod.ts";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface DuneAppOptions {
  root: string;
  port: number;
  debug?: boolean;
  /** true in dune dev — enables SSE live reload, disables page cache + compression */
  dev?: boolean;
}

export interface DuneAppResult {
  // deno-lint-ignore no-explicit-any
  app: App<any>;
  /**
   * In dev mode: push a reload event to all connected SSE clients.
   * Call this after a content rebuild so the browser auto-refreshes.
   * No-op in production.
   */
  notifyReload: () => void;
}

// ── Factory ────────────────────────────────────────────────────────────────────

export async function createDuneApp(
  ctx: BootstrapResult,
  options: DuneAppOptions,
): Promise<DuneAppResult> {
  const { root, port, debug = false, dev = false } = options;
  const {
    engine,
    collections,
    taxonomy,
    search,
    imageHandler,
    adminHandler,
    flexEngine,
    pluginAssetDirs,
    pluginAdminPages,
    stagingEngine,
    config,
    sharedThemesDir,
    hooks,
    metrics,
  } = ctx;

  const startTime = Date.now();
  const adminPrefix = config.admin?.path ?? "/admin";
  const siteName = engine.site.title;
  const feedEnabled = config.site.feed?.enabled !== false;

  const searchAnalyticsPath = join(
    config.admin?.runtimeDir ?? ".dune/admin",
    "search-analytics.jsonl",
  );
  const routes = duneRoutes(engine, collections, flexEngine, search, searchAnalyticsPath);
  const apiHandler = createApiHandler({ engine, collections, taxonomy, search, flex: flexEngine });

  // ── HTTP caching (production only) ─────────────────────────────────────────
  const httpCacheConfig = config.site.http_cache ?? {};
  const cacheDefaults = {
    maxAge: httpCacheConfig.default_max_age ?? 0,
    swr: httpCacheConfig.default_swr ?? 60,
  };
  const cacheRules = httpCacheConfig.rules ?? [];

  let pageCache: PageCache | null = null;
  if (!dev && config.system.page_cache?.enabled) {
    pageCache = createPageCache({
      maxEntries: config.system.page_cache.max_entries,
      ttl: config.system.page_cache.ttl,
    });
    if (config.system.page_cache.warm) {
      Promise.resolve().then(() => warmPageCache()).catch(() => {});
    }
  }
  if (metrics && pageCache) {
    metrics.setPageCacheRef(() => pageCache!.stats());
  }

  async function warmPageCache() {
    const toWarm = engine.pages
      .filter((p) => p.published && p.routable)
      .map((p) => p.route);
    const CONCURRENCY = 8;
    for (let i = 0; i < toWarm.length; i += CONCURRENCY) {
      await Promise.all(
        toWarm.slice(i, i + CONCURRENCY).map((route) =>
          engine.resolve(route).catch(() => {})
        ),
      );
    }
  }

  // ── Production-time prebuilds (sitemap + feeds) ────────────────────────────
  // Pre-compress the sitemap to stay under reverse-proxy buffer limits.
  let sitemapGzip: ArrayBuffer | null = null;
  let rssFeed = "";
  let atomFeed = "";

  if (!dev) {
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
    sitemapGzip = await new Response(
      new Blob([sitemapBytes]).stream().pipeThrough(new CompressionStream("gzip")),
    ).arrayBuffer();

    if (feedEnabled) {
      const siteBase = engine.site.url?.replace(/\/$/, "") || `http://localhost:${port}`;
      const feedAuthor = engine.site.author
        ? { name: engine.site.author.name, email: engine.site.author.email }
        : undefined;
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
        } catch { /* skip */ }
      }

      const baseFeedOpts: FeedOptions = {
        title: engine.site.title,
        description: engine.site.description || "",
        siteUrl: siteBase,
        feedUrl: `${siteBase}/feed.xml`,
        items,
        language: config.system.languages?.default ?? "en",
        author: feedAuthor,
      };
      rssFeed = generateRss(baseFeedOpts);
      atomFeed = generateAtom({ ...baseFeedOpts, feedUrl: `${siteBase}/atom.xml` });
    }
  }

  // ── Dev SSE live-reload infrastructure ────────────────────────────────────
  const sseClients = new Set<ReadableStreamDefaultController<Uint8Array>>();

  function notifyReload(): void {
    if (!dev) return;
    const message = new TextEncoder().encode("data: reload\n\n");
    for (const ctrl of sseClients) {
      try {
        ctrl.enqueue(message);
      } catch {
        sseClients.delete(ctrl);
      }
    }
  }

  // ── Helper: wrap freshCtx.render() into a renderJsx function ──────────────
  // routes.contentHandler accepts (req, renderJsx) — this maps ctx.render()
  // to that interface and preserves the status code for 404s/500s.
  function makeRenderJsx(
    render: (vnode: unknown) => Response | Promise<Response>,
  ) {
    return async (jsx: unknown, statusCode = 200): Promise<Response> => {
      const res = await render(jsx);
      if (statusCode === 200) return res;
      return new Response(res.body, { status: statusCode, headers: res.headers });
    };
  }

  // ── Helper: dev feed building (on-demand, not pre-built) ──────────────────
  async function buildDevFeedItems(): Promise<FeedItem[]> {
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

  // ── App assembly ──────────────────────────────────────────────────────────
  const app = new App<AdminState>();

  // 1. Static files — serves /_fresh/js/* from build cache + theme static files
  app.use(staticFiles());

  // 2. Plugin onRequest hook — fires before all routing
  app.use(async (fc) => {
    const startMs = performance.now();
    const hookResult = await hooks.fire<Request | Response>("onRequest", fc.req);
    if (hookResult instanceof Response) {
      metrics?.recordRequest(fc.url.pathname, performance.now() - startMs, hookResult.status >= 500);
      return hookResult;
    }
    return fc.next();
  });

  // 3. Health check
  app.get("/health", () =>
    Response.json({
      status: "ok",
      uptime: Math.floor((Date.now() - startTime) / 1000),
      pages: engine.pages.length,
      cache: pageCache ? pageCache.stats() : null,
    }, { headers: { "Cache-Control": "no-cache" } })
  );

  // 4. Sitemap
  app.get("/sitemap.xml", async (fc) => {
    if (!dev && sitemapGzip) {
      return new Response(sitemapGzip, {
        headers: {
          "Content-Type": "application/xml; charset=utf-8",
          "Content-Encoding": "gzip",
          "Content-Length": String(sitemapGzip.byteLength),
          "Cache-Control": "public, max-age=3600, must-revalidate",
          "Vary": "Accept-Encoding",
        },
      });
    }
    // Dev: generate on demand
    const siteUrl = config.site.url || `http://localhost:${port}`;
    const homeSlug = config.site.home ?? detectHomeSlug(engine.pages);
    const xml = generateSitemap(engine.pages, {
      siteUrl,
      supportedLanguages: config.system.languages?.supported,
      defaultLanguage: config.system.languages?.default,
      includeDefaultInUrl: config.system.languages?.include_default_in_url,
      homeSlug,
      exclude: config.site.sitemap?.exclude,
      changefreqOverrides: config.site.sitemap?.changefreq,
    });
    return new Response(xml, {
      headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-cache" },
    });
  });

  app.get("/sitemap.xsl", () =>
    new Response(SITEMAP_XSL, {
      headers: {
        "Content-Type": "text/xsl; charset=utf-8",
        "Cache-Control": dev ? "no-cache" : "public, max-age=86400",
      },
    })
  );

  // 5. Feeds
  if (feedEnabled) {
    app.get("/feed.xml", async (fc) => {
      if (!dev && rssFeed) {
        return await maybeCompress(fc.req, new Response(rssFeed, {
          headers: {
            "Content-Type": "application/rss+xml; charset=utf-8",
            "Cache-Control": "public, max-age=3600, must-revalidate",
          },
        }));
      }
      const items = await buildDevFeedItems();
      const siteBase = config.site.url?.replace(/\/$/, "") || `http://localhost:${port}`;
      const opts: FeedOptions = {
        title: engine.site.title,
        description: engine.site.description || "",
        siteUrl: siteBase,
        feedUrl: `${siteBase}/feed.xml`,
        items,
        language: config.system.languages?.default ?? "en",
        author: engine.site.author
          ? { name: engine.site.author.name, email: engine.site.author.email }
          : undefined,
      };
      return new Response(generateRss(opts), {
        headers: { "Content-Type": "application/rss+xml; charset=utf-8", "Cache-Control": "no-cache" },
      });
    });

    app.get("/atom.xml", async (fc) => {
      if (!dev && atomFeed) {
        return await maybeCompress(fc.req, new Response(atomFeed, {
          headers: {
            "Content-Type": "application/atom+xml; charset=utf-8",
            "Cache-Control": "public, max-age=3600, must-revalidate",
          },
        }));
      }
      const items = await buildDevFeedItems();
      const siteBase = config.site.url?.replace(/\/$/, "") || `http://localhost:${port}`;
      const opts: FeedOptions = {
        title: engine.site.title,
        description: engine.site.description || "",
        siteUrl: siteBase,
        feedUrl: `${siteBase}/atom.xml`,
        items,
        language: config.system.languages?.default ?? "en",
        author: engine.site.author
          ? { name: engine.site.author.name, email: engine.site.author.email }
          : undefined,
      };
      return new Response(generateAtom(opts), {
        headers: { "Content-Type": "application/atom+xml; charset=utf-8", "Cache-Control": "no-cache" },
      });
    });
  }

  // 6. Staged preview
  app.get("/__preview", async (fc) => {
    const result = await serveStagedPreview(fc.url, engine, stagingEngine);
    return result ?? withSecurityHeaders(
      renderErrorPage(404, "Not Found", "Preview not found or token invalid.", siteName),
    );
  });

  // 7. Dev SSE live-reload endpoint
  if (dev) {
    app.get("/__dune_reload", () => {
      const body = new ReadableStream<Uint8Array>({
        start(ctrl) {
          sseClients.add(ctrl);
          ctrl.enqueue(new TextEncoder().encode(": connected\n\n"));
        },
        cancel() { /* client disconnected */ },
      });
      return new Response(body, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          "Access-Control-Allow-Origin": "*",
        },
      });
    });
  }

  // 8. Admin panel — file-system routes handle all /admin/* requests.
  if (config.admin?.enabled !== false) {
    app.fsRoutes(adminPrefix);

    // 8b. Plugin admin pages — registered programmatically after fsRoutes so
    // core routes take precedence. Each plugin page gets its own GET handler
    // under the admin prefix; the admin middleware (already applied by fsRoutes)
    // handles authentication before the handler is invoked.
    if (pluginAdminPages && pluginAdminPages.length > 0) {
      for (const page of pluginAdminPages) {
        const fullPath = `${adminPrefix}${page.path}`;
        app.get(fullPath, (fc) => {
          // Honour optional permission check — middleware has already set fc.state.auth
          if (page.permission) {
            // deno-lint-ignore no-explicit-any
            const auth = (fc.state as any).auth as { authenticated?: boolean } | undefined;
            if (!auth?.authenticated) {
              return new Response(null, { status: 302, headers: { Location: `${adminPrefix}/login` } });
            }
          }
          // deno-lint-ignore no-explicit-any
          return page.handler(fc as any);
        });
      }
    }
  }

  // 9. Public form/webhook routes (no auth required)
  app.post("/api/contact", (fc) => handleContactSubmission(fc.req));
  app.get("/api/forms/:name", (fc) => handleFormSchema(fc.params.name));
  app.post("/api/forms/:name", (fc) => handleFormSubmission(fc.req, fc.params.name));
  app.post("/api/webhook/incoming", (fc) => handleIncomingWebhook(fc.req));

  // 9b. Core Dune content API. Admin API routes are handled by fsRoutes above.
  app.all("/api/*", async (fc) => {
    const apiResult = await apiHandler(fc.req);
    return apiResult ?? Response.json({ error: "Not found" }, { status: 404 });
  });

  // 10. Root-level static assets (favicon, robots.txt)
  app.get("/favicon.ico", async () => {
    const result = await serveStaticFile(root, "/favicon.ico", dev);
    return withSecurityHeaders(
      result ?? new Response(null, { status: 404 }),
    );
  });
  app.get("/favicon.svg", async () => {
    const result = await serveStaticFile(root, "/favicon.svg", dev);
    return withSecurityHeaders(
      result ?? new Response(null, { status: 404 }),
    );
  });
  app.get("/robots.txt", async () => {
    const result = await serveStaticFile(root, "/robots.txt", dev);
    return withSecurityHeaders(
      result ?? new Response(null, { status: 404 }),
    );
  });

  // 11. Theme and site static files
  app.get("/static/*", async (fc) => {
    const result = await serveStaticFile(root, fc.url.pathname, dev, sharedThemesDir);
    return withSecurityHeaders(
      result ?? renderErrorPage(404, "Not Found", "The page you're looking for doesn't exist.", siteName),
    );
  });
  app.get("/themes/*", async (fc) => {
    const result = await serveStaticFile(root, fc.url.pathname, dev, sharedThemesDir);
    return withSecurityHeaders(
      result ?? renderErrorPage(404, "Not Found", "The page you're looking for doesn't exist.", siteName),
    );
  });

  // 12. Plugin assets
  app.get("/plugins/*", async (fc) => {
    const result = await servePluginAsset(pluginAssetDirs, fc.url.pathname, dev);
    return result
      ? withSecurityHeaders(result)
      : withSecurityHeaders(
          renderErrorPage(404, "Not Found", "The page you're looking for doesn't exist.", siteName),
        );
  });

  // 13. Co-located content media (legacy path)
  app.get("/content-media/*", async (fc) => {
    const imageResult = await imageHandler(fc.req);
    return imageResult ?? await routes.mediaHandler(fc.req);
  });

  // 14. Content catch-all — media files co-located with content + pages
  app.get("/*", async (fc) => {
    const startMs = performance.now();
    const { url, req } = fc;
    let response: Response;

    try {
      // Stat-first: try to serve co-located media before routing to the content handler.
      const lastSegment = url.pathname.split("/").pop() ?? "";
      if (lastSegment && isMediaFile(lastSegment)) {
        const mediaPath = url.pathname.slice(1);
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
          metrics?.recordRequest(url.pathname, performance.now() - startMs, response.status >= 500);
          return response;
        }
      }

      const renderJsx = makeRenderJsx((vnode) => fc.render(vnode as Parameters<typeof fc.render>[0]));

      // Production: ETag + page cache
      if (!dev) {
        const pageIndex = engine.pages.find((p) => p.route === url.pathname);
        const etag = pageIndex ? await computeEtag(pageIndex) : null;
        const policy = resolvePolicy(url.pathname, cacheRules, cacheDefaults);
        const ccValue = buildCacheControl(policy);

        // Page cache hit
        if (pageCache && etag) {
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

        // Browser ETag revalidation
        if (etag && etagMatches(req.headers.get("If-None-Match"), etag)) {
          response = new Response(null, {
            status: 304,
            headers: { "ETag": etag, "Cache-Control": ccValue },
          });
          metrics?.recordRequest(url.pathname, performance.now() - startMs, false);
          return response;
        }

        // Render
        response = await routes.contentHandler(req, renderJsx);
        if (feedEnabled) response = injectFeedLinks(siteName, response);

        // RTL injection
        const pageIndex2 = engine.pages.find((p) => p.route === url.pathname);
        const pageLang = pageIndex2?.language ?? config.system.languages?.default ?? "en";
        response = injectRtlDir(response, isRtl(pageLang, config.system.languages?.rtl_override));

        // Cache headers
        if (etag && response.status === 200) {
          const h = new Headers(response.headers);
          h.set("ETag", etag);
          h.set("Cache-Control", ccValue);
          response = new Response(response.body, { status: 200, headers: h });
        } else if (response.status === 200) {
          const h = new Headers(response.headers);
          h.set("Cache-Control", ccValue);
          response = new Response(response.body, { status: 200, headers: h });
        }

        // Store in page cache
        if (pageCache && etag && response.status === 200) {
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
        if (feedEnabled) response = injectFeedLinks(siteName, response);

        const devPage = engine.pages.find((p) => p.route === url.pathname);
        const devLang = devPage?.language ?? config.system.languages?.default ?? "en";
        response = injectRtlDir(response, isRtl(devLang, config.system.languages?.rtl_override));
        response = injectLiveReload(response);
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
  });

  return { app, notifyReload };
}
