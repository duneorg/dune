/**
 * server.ts — assembles a Fresh App with Dune as middleware.
 *
 * This is the correct integration point: Fresh owns the server and request
 * lifecycle; Dune's content routing, admin panel, plugin hooks, and static
 * file serving are registered as Fresh routes and middleware.
 *
 * Used by serve.ts (production), dev.ts (development), multisite/manager.ts,
 * and ssg/builder.ts — all paths go through a single Fresh app.
 */

import { App, staticFiles } from "fresh";
import type { BootstrapResult } from "./bootstrap.ts";
import { mountPlugins } from "../plugins/loader.ts";
import {
  withSecurityHeaders,
  isAdminPath,
} from "../cli/serve-utils.ts";
import { duneRoutes } from "../routing/routes.ts";
import { buildPluginClientBundles } from "../cli/client-bundles.ts";
import { createApiHandler } from "../api/handlers.ts";
import {
  createPageCache,
  type PageCache,
} from "../cache/mod.ts";
import { registerHealthRoutes } from "./register-health.ts";
import { registerFeeds } from "./register-feeds.ts";
import { registerStaticRoutes } from "./register-static.ts";
import { registerContentCatchAll } from "./register-middleware.ts";

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

// ── Helpers ────────────────────────────────────────────────────────────────────

// Headers stripped from the Request passed to plugin onRequest hooks so
// plugins cannot read admin session cookies or forge identity.
const HOOK_STRIPPED_HEADERS = [
  "cookie",
  "authorization",
  "x-forwarded-user",
  "x-forwarded-email",
  "x-real-user",
];

function sanitizeRequestForHook(req: Request): Request {
  const headers = new Headers(req.headers);
  for (const name of HOOK_STRIPPED_HEADERS) headers.delete(name);
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
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

// ── Factory ────────────────────────────────────────────────────────────────────

/** Wire a bootstrapped Dune context into a Fresh app, mount all plugins, and return the running app. */
export async function createDuneApp(
  ctx: BootstrapResult,
  options: DuneAppOptions,
): Promise<DuneAppResult> {
  const { root, port, debug = false, dev = false } = options;
  const { engine, collections, taxonomy, search, flexEngine, hooks, config, metrics } = ctx;
  // deno-lint-ignore no-explicit-any
  const getAdminAuth = (): import("../cli/response-transforms.ts").RunResponseTransformsOptions["auth"] => (ctx.adminContext as any)?.auth ?? null;

  const startTime = Date.now();
  const feedEnabled = config.site.feed?.enabled !== false;
  const siteName = engine.site.title;
  const adminPrefix = config.admin?.path ?? "/admin";

  const routes = duneRoutes(engine, collections, flexEngine, search);
  const apiHandler = createApiHandler({ engine, collections, taxonomy, search, flex: flexEngine });

  // HTTP caching config
  const httpCacheConfig = config.site.http_cache ?? {};
  const cacheDefaults = {
    maxAge: httpCacheConfig.default_max_age ?? 0,
    swr: httpCacheConfig.default_swr ?? 60,
  };
  const cacheRules = httpCacheConfig.rules ?? [];

  // Fingerprint of the plugin transformResponse pipeline, folded into page ETags.
  const transformFingerprint = hooks
    .plugins()
    .filter((p) => p.transformResponse)
    .map((p) => `${p.name}@${p.version}`)
    .join(",");

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
    const toWarm = engine.pages.filter((p) => p.published && p.routable).map((p) => p.route);
    const CONCURRENCY = 8;
    for (let i = 0; i < toWarm.length; i += CONCURRENCY) {
      await Promise.all(toWarm.slice(i, i + CONCURRENCY).map((r) => engine.resolve(r).catch(() => {})));
    }
  }

  // ── App assembly ──────────────────────────────────────────────────────────
  // deno-lint-ignore no-explicit-any
  const app = new App<any>();

  // 1. Static files — /_fresh/js/* from build cache
  app.use(staticFiles());

  // 2. Plugin onRequest hook — fires before all routing.
  // Credential headers are stripped so plugins cannot read admin sessions.
  // Plugin responses for admin paths are discarded (belt-and-suspenders defense
  // against a plugin bypassing admin auth).
  app.use(async (fc) => {
    const startMs = performance.now();
    const sanitizedReq = sanitizeRequestForHook(fc.req);
    const hookResult = await hooks.fire<Request | Response>("onRequest", sanitizedReq);
    if (hookResult instanceof Response) {
      if (isAdminPath(fc.url.pathname, adminPrefix)) {
        console.warn(
          `[dune] plugin onRequest tried to short-circuit admin path ${fc.url.pathname}; ignoring response.`,
        );
        await hookResult.body?.cancel().catch(() => {});
        return fc.next();
      }
      const finalResponse = stripSetCookieOnAdmin(hookResult, fc.url.pathname, adminPrefix);
      metrics?.recordRequest(fc.url.pathname, performance.now() - startMs, finalResponse.status >= 500);
      return withSecurityHeaders(finalResponse);
    }
    return fc.next();
  });

  // 3. Health routes
  const { setShuttingDown } = registerHealthRoutes(app, { config, engine, pageCache, startTime });

  // 4. Sitemap, feeds, staged preview, dev SSE
  const { notifyReload } = await registerFeeds(app, ctx, { port, dev });

  // 5. Admin panel + plugin routes — each plugin's mount() hook runs here.
  await mountPlugins(app, ctx);

  // 6. Inline-edit WebSocket — in core so it works without @dune/plugin-admin.
  //    Auth via the admin session (same cookie as /admin/*).
  app.get("/api/inline-edit/ws", async (fc) => {
    const inlineEdit = ctx.adminServices?.inlineEdit;
    if (!inlineEdit) return new Response("Inline editing not enabled", { status: 501 });
    if (fc.req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }
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
    const sourcePath = new URL(fc.req.url).searchParams.get("path");
    const SAFE_PATH_RE = /^[a-zA-Z0-9/_.-]+\.(?:md|mdx|yaml|yml|json|tsx)$/;
    if (!sourcePath || !SAFE_PATH_RE.test(sourcePath) || sourcePath.includes("..")) {
      return new Response("Invalid path", { status: 400 });
    }
    // deno-lint-ignore no-explicit-any
    const adminAuth = (ctx.adminContext as any)?.auth;
    if (!adminAuth) return new Response("Unauthorized", { status: 401 });
    const authResult = await adminAuth.authenticate(fc.req).catch(() => null);
    if (!authResult?.authenticated || !authResult.user) return new Response("Unauthorized", { status: 401 });
    if (!adminAuth.hasPermission(authResult, "pages.update")) return new Response("Forbidden", { status: 403 });
    return inlineEdit.handleUpgrade(fc.req, { id: authResult.user.id, name: authResult.user.username });
  });

  // 7. Core content API (admin API handled by fsRoutes in plugin).
  app.all("/api/*", async (fc) => {
    const apiResult = await apiHandler(fc.req);
    return apiResult ?? Response.json({ error: "Not found" }, { status: 404 });
  });

  // 8. Static file routes: favicon, robots.txt, /static/*, /themes/*, /plugins/*, /content-media/*
  registerStaticRoutes(app, ctx, { root, dev, clientBundles, routes });

  // 9. Content catch-all with ETag, page cache, compression, plugin transforms, RTL injection.
  registerContentCatchAll(app, ctx, {
    dev,
    debug,
    pageCache,
    transformFingerprint,
    cacheRules,
    cacheDefaults,
    feedEnabled,
    siteName,
    adminPrefix,
    routes,
  });

  return { app, notifyReload, setShuttingDown };
}
