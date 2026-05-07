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

import { join } from "@std/path";
// deno-lint-ignore no-explicit-any
import type { App } from "fresh";
import type { BootstrapResult } from "../cli/bootstrap.ts";
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

    // Admin file-system routes (login, pages, users, settings, …)
    app.fsRoutes(adminPrefix);

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
  for (const route of pluginPublicRoutes ?? []) {
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
  // import.meta.url points to this file (src/admin/mount.ts).
  // The admin islands live in src/admin/islands/.
  const adminDir = new URL(".", import.meta.url).pathname;
  const islandsDir = join(adminDir, "islands");
  try {
    return Array.from(Deno.readDirSync(islandsDir))
      .filter((e) => e.isFile && e.name.endsWith(".tsx"))
      .map((e) => join(islandsDir, e.name));
  } catch {
    return []; // No islands directory (stripped build or unusual layout)
  }
}
