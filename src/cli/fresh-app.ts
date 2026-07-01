/**
 * fresh-app.ts — assembles a Fresh App with Dune as middleware.
 *
 * This is the correct integration point: Fresh owns the server and request
 * lifecycle; Dune's content routing, admin panel, plugin hooks, and static
 * file serving are registered as Fresh routes and middleware.
 *
 * Used by serve.ts (production), dev.ts (development), multisite/manager.ts,
 * and ssg/builder.ts — all paths go through a single Fresh app.
 */

import { App, staticFiles } from "fresh";
import { join } from "@std/path";
import type { BootstrapResult } from "./bootstrap.ts";
import { mountPlugins } from "../plugins/loader.ts";
import {
  withSecurityHeaders,
  maybeCompress,
  serveStaticFile,
  servePluginAsset,
  renderErrorPage,
  injectFeedLinks,
  injectLiveReload,
  injectRtlDir,
  isAdminPath,
} from "./serve-utils.ts";
import { isRtl } from "../i18n/rtl.ts";
import { duneRoutes } from "../routing/routes.ts";
import { hasAdminSessionCookie } from "./admin-bar-inject.ts";
import { runPluginResponseTransforms } from "./response-transforms.ts";
import { buildPluginClientBundles, serveClientBundle } from "./client-bundles.ts";
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

/** Options for {@link createDuneApp}. */
export interface DuneAppOptions {
  root: string;
  port: number;
  debug?: boolean;
  /** true in dune dev — enables SSE live reload, disables page cache + compression */
  dev?: boolean;
}

/** Handles and utilities returned by {@link createDuneApp}. */
export interface DuneAppResult {
  // deno-lint-ignore no-explicit-any
  app: App<any>;
  /**
   * In dev mode: push a reload event to all connected SSE clients.
   * Call this after a content rebuild so the browser auto-refreshes.
   * No-op in production.
   */
  notifyReload: () => void;
  /**
   * Signal that the process is shutting down.
   * When true, /health/ready returns 503 so load balancers stop sending
   * new traffic before the process exits.
   */
  setShuttingDown: (value: boolean) => void;
}

// ── Factory ────────────────────────────────────────────────────────────────────

/** Wire a bootstrapped Dune context into a Fresh app, mount all plugins, and return the running app. */
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
    flexEngine,
    pluginAssetDirs,
    config,
    sharedThemesDir,
    hooks,
    metrics,
  } = ctx;
  // auth and stagingEngine are owned by the admin plugin; read lazily from
  // adminContext so they're available after mountPlugins() has run.
  // adminContext is typed as Record<string,unknown> in core to avoid a publish-time
  // circular dependency with @dune/plugin-admin; cast lazily here.
  // deno-lint-ignore no-explicit-any
  const getAdminAuth = (): import("../cli/response-transforms.ts").RunResponseTransformsOptions["auth"] => (ctx.adminContext as any)?.auth ?? null;
  // deno-lint-ignore no-explicit-any
  const getAdminStaging = (): import("../staging/engine.ts").StagingEngine | undefined => (ctx.adminContext as any)?.staging;

  const startTime = Date.now();
  const siteName = engine.site.title;
  const feedEnabled = config.site.feed?.enabled !== false;
  const adminPrefix = config.admin?.path ?? "/admin";

  const routes = duneRoutes(engine, collections, flexEngine, search);
  const apiHandler = createApiHandler({ engine, collections, taxonomy, search, flex: flexEngine });

  // ── HTTP caching (production only) ─────────────────────────────────────────
  const httpCacheConfig = config.site.http_cache ?? {};
  const cacheDefaults = {
    maxAge: httpCacheConfig.default_max_age ?? 0,
    swr: httpCacheConfig.default_swr ?? 60,
  };
  const cacheRules = httpCacheConfig.rules ?? [];

  // Fingerprint of the plugin transformResponse pipeline, folded into page
  // ETags so adding, removing, or upgrading a transform plugin invalidates
  // browser-revalidated (304) copies and in-process page-cache entries.
  // Plugins register during bootstrap, before createDuneApp runs, so this is
  // stable for the process lifetime.
  const transformFingerprint = hooks
    .plugins()
    .filter((p) => p.transformResponse)
    .map((p) => `${p.name}@${p.version}`)
    .join(",");

  // Bundle plugin client entries (browser code declared via
  // DunePlugin.clientEntries) — served at /plugins/{name}/{entry}.js.
  // No-op (and no cost) when no plugin declares entries.
  const clientBundles = await buildPluginClientBundles(hooks.plugins(), { root, dev });

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

  /**
   * Truncate and strip control characters from a user-supplied string before
   * writing it to the server log. Prevents log-noise amplification (LOW-4)
   * and CRLF / ANSI-escape injection from a malicious URL path.
   *
   * Refs: claudedocs/security-audit-2026-05.md LOW-4 (CWE-117).
   */
  function sanitizeForLog(s: string): string {
    if (typeof s !== "string") return String(s);
    // Strip C0 controls (incl. CR, LF, NUL) and DEL — they break log scrapers
    // and can be used to inject fake log lines.
    // deno-lint-ignore no-control-regex -- stripping control chars is the intent
    let cleaned = s.replace(/[\x00-\x1f\x7f]/g, "?");
    if (cleaned.length > 256) cleaned = cleaned.slice(0, 256) + "…";
    return cleaned;
  }

  /**
   * Constant-time equality check for short configuration tokens. Prevents
   * timing-side-channel probing of /health?token= and similar tokens. Both
   * arguments must already be the same length (caller's responsibility).
   */
  function timingSafeStringEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
      diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
  }

  // ── Plugin onRequest sanitization helpers ────────────────────────────────
  // Headers stripped from the Request passed to plugin onRequest hooks.
  // These either carry session credentials (Cookie, Authorization) or could
  // be used to forge identity in plugin-side auth checks. Plugins that need
  // the authenticated user should use a post-auth hook instead.
  const HOOK_STRIPPED_HEADERS = [
    "cookie",
    "authorization",
    "x-forwarded-user",
    "x-forwarded-email",
    "x-real-user",
  ];

  function sanitizeRequestForHook(req: Request): Request {
    const headers = new Headers(req.headers);
    for (const name of HOOK_STRIPPED_HEADERS) {
      headers.delete(name);
    }
    return new Request(req.url, {
      method: req.method,
      headers,
      body: req.body,
      // deno-lint-ignore no-explicit-any
      ...(req.body ? { duplex: "half" } as any : {}),
      redirect: req.redirect,
      referrer: req.referrer,
      referrerPolicy: req.referrerPolicy,
      mode: req.mode,
      credentials: req.credentials,
      cache: req.cache,
      integrity: req.integrity,
      keepalive: req.keepalive,
      signal: req.signal,
    });
  }

  function stripSetCookieOnAdmin(res: Response, pathname: string, prefix: string): Response {
    if (!isAdminPath(pathname, prefix)) return res;
    if (!res.headers.has("set-cookie")) return res;
    const headers = new Headers(res.headers);
    headers.delete("set-cookie");
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  }

  // ── App assembly ──────────────────────────────────────────────────────────
  // deno-lint-ignore no-explicit-any
  const app = new App<any>();

  // 1. Static files — serves /_fresh/js/* from build cache + theme static files
  app.use(staticFiles());

  // 2. Plugin onRequest hook — fires before all routing.
  // The hook runs before admin auth, so we MUST strip credential-bearing
  // headers from the Request passed to plugins. Without this, any installed
  // plugin can read the admin session cookie and impersonate the user.
  // Plugins that need authentication state should use a post-auth hook or
  // the PluginApi `auth` surface, not raw cookies.
  //
  // We also refuse to honor plugin-returned Responses for admin paths.
  // Otherwise the first plugin to return a Response can mint sessions or
  // bypass _middleware (no auth, no CSRF, no security headers).
  app.use(async (fc) => {
    const startMs = performance.now();
    const sanitizedReq = sanitizeRequestForHook(fc.req);
    const hookResult = await hooks.fire<Request | Response>("onRequest", sanitizedReq);
    if (hookResult instanceof Response) {
      // Path is under the admin prefix? Drop the plugin response, log a
      // warning, and let admin routing handle the request normally.
      if (isAdminPath(fc.url.pathname, adminPrefix)) {
        console.warn(
          `[dune] plugin onRequest tried to short-circuit admin path ${fc.url.pathname}; ignoring response.`,
        );
        await hookResult.body?.cancel().catch(() => {});
        return fc.next();
      }
      // Strip Set-Cookie from plugin-returned responses on admin paths so
      // a plugin can't mint sessions that bypass the login flow. (Belt-and-
      // suspenders: the admin-path branch above already short-circuits.)
      const finalResponse = stripSetCookieOnAdmin(hookResult, fc.url.pathname, adminPrefix);
      metrics?.recordRequest(fc.url.pathname, performance.now() - startMs, finalResponse.status >= 500);
      return finalResponse;
    }
    return fc.next();
  });

  // 3. Health check
  //
  // The default response is intentionally minimal — `{ "status": "ok" }`.
  // Detailed runtime info (uptime, page count, cache stats) is useful for
  // monitoring but useful for fingerprinting too. Operators who want the
  // detailed body set system.health_token and call:
  //
  //     GET /health?detailed=true&token=<value>
  //
  // Comparison is constant-time so the token can't be probed character-by-
  // character via response timing.
  //
  // Refs: claudedocs/security-audit-2026-05.md LOW-3 (CWE-200).
  app.get("/health", (fc) => {
    const detailed = fc.url.searchParams.get("detailed") === "true";
    const token = fc.url.searchParams.get("token");
    const configured = config.system?.health_token;
    const tokenOk = typeof configured === "string" &&
      configured.length > 0 &&
      typeof token === "string" &&
      token.length === configured.length &&
      timingSafeStringEqual(token, configured);

    if (detailed && tokenOk) {
      return Response.json({
        status: "ok",
        uptime: Math.floor((Date.now() - startTime) / 1000),
        pages: engine.pages.length,
        cache: pageCache ? pageCache.stats() : null,
      }, { headers: { "Cache-Control": "no-cache" } });
    }
    return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-cache" } });
  });

  // 3a. Liveness probe — is the process running and not deadlocked?
  //     Always returns 200 as long as the event loop is responsive.
  //     Kubernetes: livenessProbe.httpGet.path: /health/live
  app.get("/health/live", () => {
    return Response.json(
      { status: "alive" },
      { headers: { "Cache-Control": "no-cache" } },
    );
  });

  // 3b. Readiness probe — is the engine ready to serve content?
  //     Returns 200 once the content index is built, 503 otherwise.
  //     Returns 503 during graceful shutdown so load balancers drain traffic
  //     before the process exits.
  //     Kubernetes: readinessProbe.httpGet.path: /health/ready
  let shuttingDown = false;
  const setShuttingDown = (value: boolean) => { shuttingDown = value; };

  app.get("/health/ready", () => {
    if (shuttingDown) {
      return Response.json(
        { status: "shutting_down" },
        { status: 503, headers: { "Cache-Control": "no-cache" } },
      );
    }
    const ready = Array.isArray(engine.pages);
    return Response.json(
      {
        status: ready ? "ready" : "not_ready",
        pages: engine.pages.length,
      },
      {
        status: ready ? 200 : 503,
        headers: { "Cache-Control": "no-cache" },
      },
    );
  });

  // 4. Sitemap
  app.get("/sitemap.xml", async (_fc) => {
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
    const result = await serveStagedPreview(fc.url, engine, getAdminStaging());
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

  // 8. Admin panel + plugin routes + public API — delegated to mountPlugins().
  // Each plugin's mount() hook runs here; the built-in admin plugin calls
  // mountDuneAdmin() internally so full-mode and headless mode share the same path.
  await mountPlugins(app, ctx);

  // 9a. Inline-edit WebSocket — registered in core so it works independently
  // of @dune/plugin-admin. Auth via the admin auth provider (same session as
  // /admin/*) so the cookie-based session grants access without a separate
  // public-user auth requirement.
  app.get("/api/inline-edit/ws", async (fc) => {
    const inlineEdit = ctx.adminServices?.inlineEdit;
    if (!inlineEdit) {
      return new Response("Inline editing not enabled", { status: 501 });
    }
    if (fc.req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    // Origin check: reject cross-origin WebSocket upgrades (CSWSH).
    const origin = fc.req.headers.get("origin");
    if (origin) {
      try {
        if (new URL(origin).host !== new URL(fc.req.url).host) {
          return new Response("Cross-origin WebSocket rejected", { status: 403 });
        }
      } catch {
        return new Response("Cross-origin WebSocket rejected", { status: 403 });
      }
    }

    // Validate `path` param: must look like a relative content file path.
    const sourcePath = new URL(fc.req.url).searchParams.get("path");
    const SAFE_PATH_RE = /^[a-zA-Z0-9/_.-]+\.(?:md|mdx|yaml|yml|json|tsx)$/;
    if (!sourcePath || !SAFE_PATH_RE.test(sourcePath) || sourcePath.includes("..")) {
      return new Response("Invalid path", { status: 400 });
    }

    // Auth: require an authenticated admin session (via cookie).
    // deno-lint-ignore no-explicit-any
    const adminAuth = (ctx.adminContext as any)?.auth;
    if (!adminAuth) {
      return new Response("Unauthorized", { status: 401 });
    }
    const authResult = await adminAuth.authenticate(fc.req).catch(() => null);
    if (!authResult?.authenticated || !authResult.user) {
      return new Response("Unauthorized", { status: 401 });
    }
    if (!adminAuth.hasPermission(authResult, "pages.update")) {
      return new Response("Forbidden", { status: 403 });
    }

    return inlineEdit.handleUpgrade(fc.req, {
      id: authResult.user.id,
      name: authResult.user.username,
    });
  });

  // 9. Core Dune content API. Admin API routes are handled by fsRoutes above.
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
  //
  // /static/, /themes/, and /plugins/ are reserved path prefixes, but a
  // content page-folder can legitimately have one of those words as its
  // own slug (e.g. a "plugins" or "themes" docs page) — and since 0.20.0,
  // page-folder pages serve at that exact trailing-slash route. Without a
  // fallback, /plugins/ or /themes/ would be eaten by these wildcard
  // routes and 404 from the static-asset layer even though the content
  // layer has a real page there (and confidently 301s to it from the
  // no-slash form, since canonical-redirect resolution goes through the
  // content router, not these handlers). Falling through to content
  // resolution when nothing static matches closes that gap.
  app.get("/static/*", async (fc) => {
    const result = await serveStaticFile(root, fc.url.pathname, dev, sharedThemesDir);
    if (result) return withSecurityHeaders(result);
    const renderJsx = makeRenderJsx((vnode) => fc.render(vnode as Parameters<typeof fc.render>[0]));
    return withSecurityHeaders(await routes.contentHandler(fc.req, renderJsx));
  });
  app.get("/themes/*", async (fc) => {
    const result = await serveStaticFile(root, fc.url.pathname, dev, sharedThemesDir);
    if (result) return withSecurityHeaders(result);
    const renderJsx = makeRenderJsx((vnode) => fc.render(vnode as Parameters<typeof fc.render>[0]));
    return withSecurityHeaders(await routes.contentHandler(fc.req, renderJsx));
  });

  // 12. Plugin assets — bundled client entries first, then static assetDir files.
  app.get("/plugins/*", async (fc) => {
    const bundleResult = serveClientBundle(clientBundles, fc.url.pathname, fc.req, dev);
    if (bundleResult) return withSecurityHeaders(bundleResult);
    const result = await servePluginAsset(pluginAssetDirs, fc.url.pathname, dev);
    if (result) return withSecurityHeaders(result);
    const renderJsx = makeRenderJsx((vnode) => fc.render(vnode as Parameters<typeof fc.render>[0]));
    return withSecurityHeaders(await routes.contentHandler(fc.req, renderJsx));
  });

  // 13. Co-located content media (legacy path)
  app.get("/content-media/*", async (fc) => {
    const imageResult = await imageHandler(fc.req);
    return imageResult ?? await routes.mediaHandler(fc.req);
  });

  // 14. Content catch-all — media files co-located with content + pages.
  // Handles all HTTP methods so that .tsx content pages can export Handlers
  // with POST/PUT/DELETE methods (mirroring Fresh's Handlers idiom).
  app.all("/*", async (fc) => {
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
            // admin cookies or hit same-origin endpoints. See HIGH-12,
            // HIGH-13.
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

      // Production: ETag + page cache
      if (!dev) {
        const pageIndex = engine.pages.find((p) => p.route === url.pathname);
        const etag = pageIndex ? await computeEtag(pageIndex, transformFingerprint) : null;
        const policy = resolvePolicy(url.pathname, cacheRules, cacheDefaults);
        const ccValue = buildCacheControl(policy);

        // Requests carrying an admin session cookie must bypass the shared
        // page cache entirely (read AND write): their rendered response may
        // include the injected admin bar (username, edit chrome, content API
        // URLs), which must never be stored under the anonymous pathname key
        // — and conversely an admin must never be served the anonymous copy
        // without the bar.
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

        // Browser ETag revalidation — skipped for admin-session requests:
        // their response body differs from the anonymous variant (injected
        // admin bar), so a 304 against an anonymous browser-cached copy
        // would show the wrong variant.
        if (etag && !bypassPageCache && etagMatches(req.headers.get("If-None-Match"), etag)) {
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

        // RTL injection — strip language prefix from URL before matching
        const rtlSupportedLangs = config.system.languages?.supported ?? [];
        const rtlUrlSegments = url.pathname.split("/");
        const pageLang =
          rtlSupportedLangs.length > 1 &&
          rtlSupportedLangs.includes(rtlUrlSegments[1])
            ? rtlUrlSegments[1]
            : (config.system.languages?.default ?? "en");
        response = injectRtlDir(response, isRtl(pageLang, config.system.languages?.rtl_override));

        // Cache headers. Admin-session responses are marked private/no-store
        // and carry no ETag so neither a shared cache (CDN, proxy) nor the
        // browser ever revalidates a bar-injected body against the anonymous
        // variant.
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

        // Store in page cache (never for admin-session responses)
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

        // Plugin response transforms (e.g. admin bar injection).
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
          devSupportedLangs.length > 1 &&
          devSupportedLangs.includes(devUrlSegments[1])
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

  return { app, notifyReload, setShuttingDown };
}
