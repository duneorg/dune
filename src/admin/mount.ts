/**
 * Headless-mode admin mounting — composable API for Fresh developers who own
 * their own routes and want Dune only for content management.
 *
 * Instead of calling `createDuneApp()` (which owns all routes including `/*`),
 * headless developers use `mountDuneAdmin()` to bolt on Dune's admin panel and
 * public API, then wire their own `routes/` directory via `app.fsRoutes()`.
 *
 * @example
 * ```ts
 * import { App } from "fresh";
 * import { Builder } from "jsr:@fresh/core@^2/dev";
 * import { bootstrap } from "@dune/cms";
 * import { mountDuneAdmin, getDuneAdminIslands } from "@dune/cms/admin";
 *
 * const ctx = await bootstrap("./");
 * const app = new App();
 *
 * await mountDuneAdmin(app, ctx);
 * app.fsRoutes("./routes");  // developer owns all public routes
 *
 * const builder = new Builder({
 *   root: "./",
 *   islandDir: "./islands",
 *   islandSpecifiers: getDuneAdminIslands(),
 * });
 * const applySnapshot = await builder.build({ mode: "production", snapshot: "memory" });
 * applySnapshot(app);
 *
 * Deno.serve({ port: 3000, handler: app.handler() });
 * ```
 *
 * @module
 * @since 1.1.0
 */

// deno-lint-ignore no-explicit-any
import type { App, Middleware } from "fresh";
import type { BootstrapResult } from "../cli/bootstrap.ts";
import { adminIslands, adminLayout, adminMiddleware, adminRoutes } from "./manifest.gen.ts";
import {
  handleContactSubmission,
  handleFormSchema,
  handleFormSubmission,
  handleIncomingWebhook,
} from "./public-api.ts";

/**
 * Mount Dune's admin panel and public API routes onto an existing Fresh app.
 *
 * Registers:
 * - Per-site admin context middleware (required for admin route handlers)
 * - Admin file-system routes under `adminPrefix` (default `/admin`)
 * - Plugin admin pages (programmatic routes registered by plugins)
 * - Plugin public routes (registered by plugins)
 * - Public form and webhook API endpoints
 *
 * @param app - The Fresh App instance to mount onto.
 * @param ctx - A fully-bootstrapped BootstrapResult from `bootstrap()`.
 */
export async function mountDuneAdmin(
  // deno-lint-ignore no-explicit-any
  app: App<any>,
  ctx: BootstrapResult,
): Promise<void> {
  const { config, adminContext, pluginAdminPages, pluginPublicRoutes } = ctx;
  const adminPrefix = config.admin?.path ?? "/admin";

  // ── Admin panel ─────────────────────────────────────────────────────────────
  if (config.admin?.enabled !== false) {
    // Per-site admin context middleware — captures the correct context in
    // closure so multisite setups don't suffer from the module-level singleton.
    if (adminContext) {
      const adminCtx = adminContext;
      app.use(async (fc) => {
        fc.state.adminContext = adminCtx;
        return fc.next();
      });
    }

    // Admin routes (login, pages, users, settings, …) — registered
    // programmatically from the generated manifest instead of fsRoutes().
    // Fresh's fsRoutes() discovers route files by scanning a local directory,
    // which silently yields zero routes when Dune runs from JSR (import.meta.url
    // is https://, so there is no local directory). The manifest's static
    // imports resolve through the module graph and work from any origin.
    registerAdminRoutes(app, adminPrefix);

    // Plugin admin pages — programmatic routes under admin prefix.
    // The admin _middleware enforces authentication; here we additionally
    // honour the plugin-declared permission (if any) so plugin authors can
    // restrict access to a subset of admin roles.
    if (pluginAdminPages && pluginAdminPages.length > 0 && adminContext) {
      const adminCtx = adminContext;
      for (const page of pluginAdminPages) {
        const fullPath = `${adminPrefix}${page.path}`;
        app.get(fullPath, (fc) => {
          // deno-lint-ignore no-explicit-any
          const authResult = (fc.state as any).auth;
          if (!authResult?.authenticated) {
            return new Response(null, { status: 302, headers: { Location: `${adminPrefix}/login` } });
          }
          if (page.permission) {
            // deno-lint-ignore no-explicit-any
            const ok = adminCtx.auth.hasPermission(authResult, page.permission as any);
            if (!ok) {
              return new Response("Forbidden", { status: 403 });
            }
          }
          // deno-lint-ignore no-explicit-any
          return page.handler(fc as any);
        });
      }
    }
  }

  // ── Plugin public routes ────────────────────────────────────────────────────
  // Plugins register routes via DunePlugin.publicRoutes. Validate that:
  //   1. The route path is a string starting with "/"
  //   2. The route path doesn't shadow the admin prefix or built-in
  //      /api/* endpoints — otherwise a plugin could overwrite admin or
  //      core API behavior at request time.
  // Reserved prefixes match how Fresh routes resolve: a plugin "/admin/foo"
  // would be served before the admin file-system routes for any path that
  // didn't match an admin route exactly.
  const reservedPrefixes = [
    adminPrefix,
    "/api/contact",
    "/api/forms",
    "/api/webhook",
    "/_fresh",
    "/health",
  ];
  for (const route of pluginPublicRoutes ?? []) {
    if (typeof route.path !== "string" || !route.path.startsWith("/")) {
      console.warn(`[dune] plugin route rejected: path must be a string starting with "/" (got ${JSON.stringify(route.path)})`);
      continue;
    }
    const normalized = route.path.replace(/\/+$/, "") || "/";
    const shadowed = reservedPrefixes.find((p) =>
      normalized === p || normalized.startsWith(p + "/")
    );
    if (shadowed) {
      console.warn(`[dune] plugin route ${route.path} rejected: shadows reserved prefix ${shadowed}`);
      continue;
    }
    const method = (route.method ?? "GET").toLowerCase() as "get" | "post" | "put" | "delete" | "all";
    app[method](route.path, route.handler);
  }

  // ── Public form / webhook API ───────────────────────────────────────────────
  // Bind handlers to the per-site adminContext via closure so multisite
  // deployments can't leak across tenants via a process-wide singleton.
  if (adminContext) {
    const adminCtx = adminContext;
    app.post("/api/contact", (fc) => handleContactSubmission(adminCtx, fc.req));
    app.get("/api/forms/:name", (fc) => handleFormSchema(adminCtx, fc.params.name));
    app.post("/api/forms/:name", (fc) => handleFormSubmission(adminCtx, fc.req, fc.params.name));
    app.post("/api/webhook/incoming", (fc) => handleIncomingWebhook(adminCtx, fc.req));
  }
}

/**
 * Return absolute paths to all island `.tsx` files bundled with Dune's admin
 * panel. Pass these to Fresh `Builder({ islandSpecifiers })` so admin islands
 * are included in the production JS bundle.
 *
 * @example
 * ```ts
 * const builder = new Builder({
 *   root: "./",
 *   islandDir: "./islands",
 *   islandSpecifiers: getDuneAdminIslands(),
 * });
 * ```
 */
export function getDuneAdminIslands(): string[] {
  // Resolve island specifiers from the generated manifest rather than
  // scanning the directory: when Dune runs from JSR, import.meta.url is an
  // https:// URL and there is no local directory to scan. Fresh's
  // registerIsland() accepts both absolute file paths and https:// URLs.
  return adminIslands.map((name) => {
    const url = new URL(`./islands/${name}`, import.meta.url);
    return url.protocol === "file:" ? url.pathname : url.href;
  });
}

/**
 * Register all admin panel routes on a Fresh app under `adminPrefix`.
 *
 * Replaces `app.fsRoutes(adminPrefix)`: Fresh's fsRoutes() discovers route
 * files by crawling a local directory at build time, which silently yields
 * zero routes when Dune runs from JSR (import.meta.url is https://). The
 * generated manifest imports every route module statically, so registration
 * works identically from JSR and from a local checkout.
 *
 * The admin auth middleware and shell layout are registered app-wide; both
 * self-guard and pass through untouched on non-admin paths (they must,
 * because Fresh applies fs middleware/layouts globally too — this preserves
 * the exact fsRoutes() behavior).
 */
export function registerAdminRoutes(
  // deno-lint-ignore no-explicit-any
  app: App<any>,
  adminPrefix: string,
): void {
  const prefix = adminPrefix === "/" ? "" : adminPrefix.replace(/\/+$/, "");

  // deno-lint-ignore no-explicit-any
  app.use(adminMiddleware.handler as Middleware<any>);
  // deno-lint-ignore no-explicit-any
  app.layout("*", adminLayout.default as any);

  for (const { pattern, mod } of adminRoutes) {
    const path = pattern === "/" ? (prefix || "/") : `${prefix}${pattern}`;
    app.route(path, {
      component: mod.default,
      handler: mod.handlers ?? mod.handler,
      config: mod.config,
      // deno-lint-ignore no-explicit-any
    } as any);
  }
}
