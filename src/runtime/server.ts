/**
 * server.ts — assembles a Fresh App with Dune as middleware.
 *
 * This is the correct integration point: Fresh owns the server and request
 * lifecycle; Dune's content routing, admin panel, plugin hooks, and static
 * file serving are registered as Fresh routes and middleware.
 *
 * Used by serve.ts (production), dev.ts (development), multisite/manager.ts,
 * and ssg/builder.ts — all paths go through a single Fresh app.
 *
 * @module
 */

import { App, staticFiles } from "fresh";
import { captureHandlerSocketAddr, copySocketAddr } from "../security/rate-limit.ts";
import type { BootstrapResult } from "./bootstrap.ts";
import type { DuneAuthSystem } from "../auth/authz.ts";
import { mountPlugins } from "../plugins/loader.ts";
import { mountDuneAuth } from "../auth/mount.ts";
import { getUser, USER_HEADER } from "../auth/types.ts";
import { isAdminPath, withSecurityHeaders } from "../cli/serve-utils.ts";
import { duneRoutes } from "../routing/routes.ts";
import { buildPluginClientBundles } from "../cli/client-bundles.ts";
import { createApiHandler } from "../api/handlers.ts";
import { createPageCache, type PageCache } from "../cache/mod.ts";
import { registerHealthRoutes } from "./register-health.ts";
import { registerFeeds } from "./register-feeds.ts";
import { registerStaticRoutes } from "./register-static.ts";
import { registerContentCatchAll } from "./register-middleware.ts";
import { registerPluginPublicRoutes } from "./register-plugin-routes.ts";
export { registerPluginPublicRoutes } from "./register-plugin-routes.ts";
export type { RegisterPluginPublicRoutesOptions } from "./register-plugin-routes.ts";

// ── Types ──────────────────────────────────────────────────────────────────────

/** Options for {@link createDuneApp}. */
export interface DuneAppOptions {
  root: string;
  port: number;
  debug?: boolean;
  /** true in dune dev — enables SSE live reload, disables page cache + compression */
  dev?: boolean;
  /**
   * Mount the public-auth subsystem (mountDuneAuth()) when `site.auth` is
   * configured. Default true. Set false for non-serving contexts that
   * shouldn't create session/user-store directories or register /auth/*
   * routes — e.g. the SSG builder, which calls createDuneApp() purely to
   * get an in-process handler for rendering static pages.
   */
  mountAuth?: boolean;
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
  const next = new Request(req.url, {
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
  copySocketAddr(req, next);
  return next;
}

/**
 * Strip any externally-supplied `x-dune-user` header from a request. This
 * header (`USER_HEADER` in `src/auth/types.ts`) is set internally by
 * Dune's own middleware and read by `requireAuth()`/`getUser()`; incoming
 * requests must never be allowed to set it themselves. Returns `req`
 * unchanged when the header isn't present (avoids an unnecessary Request
 * reconstruction on the common case). Exported so this is directly
 * unit-testable without a full app.
 */
export function stripUserHeader(req: Request): Request {
  if (!req.headers.has(USER_HEADER)) return req;
  const cleanHeaders = new Headers(req.headers);
  cleanHeaders.delete(USER_HEADER);
  const next = new Request(req, { headers: cleanHeaders });
  copySocketAddr(req, next);
  return next;
}

function stripSetCookieOnAdmin(
  res: Response,
  pathname: string,
  prefix: string,
): Response {
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

/**
 * Browsers always send Origin on WebSocket upgrade. Reject a missing or
 * cross-site Origin so a non-browser client cannot open the collab socket
 * with only a stolen cookie.
 */
export function assertInlineEditWsOrigin(req: Request): Response | null {
  const origin = req.headers.get("origin");
  if (!origin) {
    return new Response("Origin required", { status: 403 });
  }
  try {
    if (new URL(origin).host !== new URL(req.url).host) {
      return new Response("Cross-origin WebSocket rejected", { status: 403 });
    }
  } catch {
    return new Response("Cross-origin WebSocket rejected", { status: 403 });
  }
  return null;
}

const INLINE_EDIT_PATH_RE = /^[a-zA-Z0-9/_.-]+\.(?:md|mdx|yaml|yml|json|tsx)$/;

/** True when `sourcePath` is a relative content file with no traversal. */
export function isSafeInlineEditPath(
  sourcePath: string | null,
): sourcePath is string {
  return !!sourcePath &&
    INLINE_EDIT_PATH_RE.test(sourcePath) &&
    !sourcePath.includes("..");
}

/**
 * True when `sourcePath` is a safe relative content file that exists in the
 * page index. The WS handler used to accept any filename matching the
 * extension regex — including paths that are not pages (sidecars, planted
 * files under content/) — and pass them to the collab document store.
 */
export function isIndexedInlineEditPath(
  pages: ReadonlyArray<{ sourcePath: string }>,
  sourcePath: string | null,
): boolean {
  return isSafeInlineEditPath(sourcePath) &&
    pages.some((p) => p.sourcePath === sourcePath);
}

/**
 * Whether an authenticated admin session may perform inline edits
 * (`pages.update`). `authz` is the sole authority — the flat
 * `ROLE_PERMISSIONS` fallback this used to have was removed
 * (dec-identity-unification Phase 5c, second half): `admin.authzStore`
 * defaults to `"local"` and is created automatically whenever the admin
 * panel is enabled, regardless of `site.auth`'s mode, so `authz` being
 * undefined here means its creation itself failed at startup (already
 * logged loudly there) — an exceptional condition that should fail closed
 * (deny), not silently degrade to a materially different, less-audited
 * authorization mechanism. Extracted from the `/api/inline-edit/ws` handler
 * below and exported so this decision is directly unit-testable without a
 * full app + WebSocket-upgrade harness.
 */
export async function checkInlineEditPermission(
  authz: DuneAuthSystem | undefined,
  // deno-lint-ignore no-explicit-any
  authResult: any,
): Promise<boolean> {
  if (!authz) return false;
  return await checkPagesUpdateViaAuthz(authz, authResult.user.id);
}

function checkPagesUpdateViaAuthz(
  authz: DuneAuthSystem,
  userId: string,
): Promise<boolean> {
  return authz.check({
    who: { type: "user", id: userId },
    // deno-lint-ignore no-explicit-any
    canThey: "pages.update" as any,
    onWhat: { type: "app", id: "admin" },
  });
}

/**
 * Same `pages.update` decision as {@link checkInlineEditPermission}, for a
 * user resolved via the public-auth session (`src/auth/`, `getUser(req)`)
 * rather than an admin session — this is what lets `/api/inline-edit/ws`
 * work for a site that has `@dune/plugin-admin` decoupled entirely. There is
 * no `ROLE_PERMISSIONS` table for public-auth users (that fallback exists
 * only for admin sessions, whose roles are a closed admin-panel vocabulary),
 * so the no-authz fallback here is a direct check against the user's own
 * `roles: string[]` for an editor-equivalent role instead.
 */
export async function checkInlineEditPermissionForSiteUser(
  authz: DuneAuthSystem | undefined,
  user: { id: string; roles: string[] },
): Promise<boolean> {
  if (authz) {
    return await checkPagesUpdateViaAuthz(authz, user.id);
  }
  return user.roles.includes("editor") || user.roles.includes("admin");
}

// ── Factory ────────────────────────────────────────────────────────────────────

/** Wire a bootstrapped Dune context into a Fresh app, mount all plugins, and return the running app. */
export async function createDuneApp(
  ctx: BootstrapResult,
  options: DuneAppOptions,
): Promise<DuneAppResult> {
  const { root, port, debug = false, dev = false, mountAuth = true } = options;
  const {
    engine,
    collections,
    taxonomy,
    search,
    flexEngine,
    hooks,
    config,
    metrics,
    contentApi,
  } = ctx;

  const startTime = Date.now();
  const feedEnabled = config.site.feed?.enabled !== false;
  const siteName = engine.site.title;
  const adminPrefix = config.admin?.path ?? "/admin";

  const routes = duneRoutes(
    engine,
    collections,
    flexEngine,
    search,
    contentApi,
    hooks,
  );
  const apiHandler = createApiHandler({
    engine,
    collections,
    taxonomy,
    search,
    flex: flexEngine,
    hooks,
  });

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

  const clientBundles = await buildPluginClientBundles(hooks.plugins(), {
    root,
    dev,
  });

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
  if (pageCache) {
    // Rendered HTML may embed stale content or theme config after a content
    // rebuild or a theme-config save — drop it so the next request re-renders.
    hooks.on("onRebuild", () => pageCache!.invalidate());
    hooks.on("onCacheInvalidate", () => pageCache!.invalidate());
  }

  async function warmPageCache() {
    const toWarm = engine.pages.filter((p) => p.published && p.routable).map((
      p,
    ) => p.route);
    const CONCURRENCY = 8;
    for (let i = 0; i < toWarm.length; i += CONCURRENCY) {
      await Promise.all(
        toWarm.slice(i, i + CONCURRENCY).map((r) =>
          engine.resolve(r).catch(() => {})
        ),
      );
    }
  }

  // ── App assembly ──────────────────────────────────────────────────────────
  // deno-lint-ignore no-explicit-any
  const app = new App<any>();

  // 0. Strip any externally-supplied x-dune-user header, unconditionally,
  // before any other middleware or route sees the request. This runs
  // regardless of whether site.auth (and with it, mountDuneAuth()'s own
  // strip-then-re-inject step) is configured, so the header is never
  // trusted from an incoming request under any configuration.
  app.use(async (fc) => {
    // deno-lint-ignore no-explicit-any
    (fc as any).req = stripUserHeader(fc.req);
    return fc.next();
  });

  // 1. Static files — /_fresh/js/* from build cache
  app.use(staticFiles());

  // 2. Plugin onRequest hook — fires before all routing.
  // Credential headers are stripped so plugins cannot read admin sessions.
  // Plugin responses for admin paths are discarded (belt-and-suspenders defense
  // against a plugin bypassing admin auth).
  app.use(async (fc) => {
    const startMs = performance.now();
    const sanitizedReq = sanitizeRequestForHook(fc.req);
    const hookResult = await hooks.fire<Request | Response>(
      "onRequest",
      sanitizedReq,
    );
    if (hookResult instanceof Response) {
      if (isAdminPath(fc.url.pathname, adminPrefix)) {
        console.warn(
          `[dune] plugin onRequest tried to short-circuit admin path ${fc.url.pathname}; ignoring response.`,
        );
        await hookResult.body?.cancel().catch(() => {});
        return fc.next();
      }
      const finalResponse = stripSetCookieOnAdmin(
        hookResult,
        fc.url.pathname,
        adminPrefix,
      );
      metrics?.recordRequest(
        fc.url.pathname,
        performance.now() - startMs,
        finalResponse.status >= 500,
      );
      return withSecurityHeaders(finalResponse);
    }
    return fc.next();
  });

  // 3. Health routes
  const { setShuttingDown } = registerHealthRoutes(app, {
    config,
    engine,
    pageCache,
    startTime,
  });

  // 4. Sitemap, feeds, staged preview, dev SSE
  const { notifyReload } = await registerFeeds(app, ctx, { port, dev });

  // 5. Admin panel + plugin routes — each plugin's mount() hook runs here.
  // Must run before plugin public routes below: @dune/plugin-admin's own
  // mount() (invoked from here) adds the `fc.state.adminContext = ...`
  // middleware that publicRoutes handlers rely on for manual auth (the
  // documented pattern — see e.g. any plugin route that does
  // `fc.state?.adminContext?.auth.authenticate(fc.req)`). Registering a
  // plugin's route via `app.get()`/`app.post()` before that middleware
  // exists means the middleware chain built for that route never includes
  // it, so `fc.state.adminContext` reads as undefined at request time no
  // matter how the request is authenticated — confirmed via a live 401
  // repro before this fix (eda-worksheets' pdf-export plugin).
  await mountPlugins(app, ctx);

  // 4b. Plugin public routes (DunePlugin.publicRoutes) — core-owned, unlike
  // adminPages, so this works in every createDuneApp() context regardless of
  // whether @dune/plugin-admin (or any admin package) is present. Calling
  // this after mountPlugins() (rather than before, as originally written)
  // is what makes the ordering above work: when admin is enabled,
  // @dune/plugin-admin's own mountDuneAdmin() (invoked via mountPlugins())
  // already calls this internally, correctly ordered after its own
  // middleware within that same call — this trailing call is then a no-op
  // via the ctx-keyed WeakSet guard in registerPluginPublicRoutes(). When
  // admin is disabled (headless mode), nothing calls it during
  // mountPlugins(), so this call is what actually registers the routes —
  // unchanged from the behavior commit 77bf31f introduced this call to fix.
  registerPluginPublicRoutes(app, ctx, { adminPrefix });

  // 5b. Public auth — only when the site has an `auth:` block at all, so
  // sites that never opted in get zero behavior change (no new directories,
  // no /auth/* routes, no per-request middleware). mountDuneAuth() must run
  // after mountPlugins() so it can reuse the authz bundle bootstrap()/the
  // admin plugin already built (see mount.ts's own comment on this).
  if (mountAuth && config.site.auth) {
    await mountDuneAuth(app, ctx);
  }

  // 6. Inline-edit WebSocket — in core so it works without @dune/plugin-admin.
  //    Auth prefers the public-auth session (src/auth/, getUser(req)) set by
  //    mountDuneAuth() above — this is what makes @dune/plugin-inline-edit
  //    genuinely independent of @dune/plugin-admin when a site has `auth:`
  //    configured. Falls back to the admin session (same cookie as /admin/*)
  //    when this site has no public auth configured, which today is still
  //    the common case. Either way, the pages.update decision itself goes
  //    through authz.check() when configured — the sole authority every
  //    other permission check follows (dec-identity-unification Phase 5c/7).
  app.get("/api/inline-edit/ws", async (fc) => {
    const inlineEdit = ctx.adminServices?.inlineEdit;
    if (!inlineEdit) {
      return new Response("Inline editing not enabled", { status: 501 });
    }
    if (fc.req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }
    const originDenied = assertInlineEditWsOrigin(fc.req);
    if (originDenied) return originDenied;
    const sourcePath = new URL(fc.req.url).searchParams.get("path");
    if (!isSafeInlineEditPath(sourcePath)) {
      return new Response("Invalid path", { status: 400 });
    }
    if (!isIndexedInlineEditPath(engine.pages, sourcePath)) {
      return new Response("Unknown path", { status: 404 });
    }

    let userId: string;
    let username: string;
    let permitted: boolean;

    const siteUser = getUser(fc.req);
    if (siteUser) {
      userId = siteUser.id;
      username = siteUser.username ?? siteUser.name ?? siteUser.email;
      permitted = await checkInlineEditPermissionForSiteUser(
        ctx.authz,
        siteUser,
      );
    } else {
      // deno-lint-ignore no-explicit-any
      const adminAuth = (ctx.adminContext as any)?.auth;
      if (!adminAuth) return new Response("Unauthorized", { status: 401 });
      const authResult = await adminAuth.authenticate(fc.req).catch(() =>
        null
      );
      if (!authResult?.authenticated || !authResult.user) {
        return new Response("Unauthorized", { status: 401 });
      }
      userId = authResult.user.id;
      username = authResult.user.username;
      permitted = await checkInlineEditPermission(
        ctx.authz,
        authResult,
      );
    }

    if (!permitted) return new Response("Forbidden", { status: 403 });

    return inlineEdit.handleUpgrade(fc.req, { id: userId, name: username });
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

  const createHandler = app.handler.bind(app);
  app.handler = captureHandlerSocketAddr(createHandler);

  return { app, notifyReload, setShuttingDown };
}
