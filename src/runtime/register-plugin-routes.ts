/**
 * register-plugin-routes.ts — mounts `DunePlugin.publicRoutes` as live Fresh routes.
 *
 * Moved here from `@dune/plugin-admin`'s `mountDuneAdmin()` so `publicRoutes`
 * actually works in every `createDuneApp()` context, not only when the admin
 * package's `mount()` happens to run — headless sites, `admin.enabled: false`,
 * and `bootstrap()`-only tools all get it now. `bootstrap.ts` already collects
 * `BootstrapResult.pluginPublicRoutes`; this is the piece that was missing —
 * turning that collected list into actual `app.get()`/`app.post()`/etc. calls.
 *
 * `adminPages` is not handled here and stays `@dune/plugin-admin`-owned: its
 * registration enforces `page.permission` via the admin panel's own auth/
 * permission system, which core has no reason to depend on.
 *
 * @module
 */

import type { App } from "fresh";
import type { BootstrapResult } from "./bootstrap.ts";

/** Options for {@link registerPluginPublicRoutes}. */
export interface RegisterPluginPublicRoutesOptions {
  /** The site's admin path prefix (e.g. "/admin"), so plugin routes can't shadow it. */
  adminPrefix: string;
}

/**
 * `ctx` objects (`BootstrapResult`) for which routes have already been
 * registered — this function has two call sites that can both run for the
 * same bootstrap: `createDuneApp()` calls it directly, and
 * `@dune/plugin-admin`'s `mountDuneAdmin()` (invoked either via
 * `mountPlugins()` inside that same `createDuneApp()` call, or directly by a
 * headless-mode developer who never calls `createDuneApp()` at all) also
 * calls it, so it stays correct for headless mode without core needing to
 * know whether an admin package is present. A `WeakSet` keyed by `ctx`
 * identity makes the second call for a given bootstrap a no-op instead of
 * double-registering (which Fresh would otherwise reject or misbehave on).
 */
const registeredFor = new WeakSet<BootstrapResult>();

/**
 * Register every plugin's `publicRoutes` entries as live Fresh routes.
 *
 * Validates that each route's path is a string starting with `/` and doesn't
 * shadow a reserved prefix (admin panel, built-in public API endpoints,
 * Fresh's own asset path, health check) — otherwise a plugin could overwrite
 * admin or core API behavior at request time. Reserved-prefix matching
 * mirrors how Fresh resolves routes: a plugin route under a reserved prefix
 * would only ever be reached for paths the reserved owner didn't already
 * claim, which is not what a plugin author registering e.g. `/admin/foo`
 * would expect.
 *
 * Call before the content catch-all so plugin routes take precedence over it.
 * Safe to call more than once for the same `ctx` — see {@link registeredFor}.
 */
export function registerPluginPublicRoutes(
  // deno-lint-ignore no-explicit-any
  app: App<any>,
  ctx: BootstrapResult,
  options: RegisterPluginPublicRoutesOptions,
): void {
  if (registeredFor.has(ctx)) return;
  registeredFor.add(ctx);
  const reservedPrefixes = [
    options.adminPrefix,
    "/api/contact",
    "/api/forms",
    "/api/webhook",
    "/_fresh",
    "/health",
  ];
  for (const route of ctx.pluginPublicRoutes ?? []) {
    if (typeof route.path !== "string" || !route.path.startsWith("/")) {
      console.warn(
        `[dune] plugin route rejected: path must be a string starting with "/" (got ${
          JSON.stringify(route.path)
        })`,
      );
      continue;
    }
    const normalized = route.path.replace(/\/+$/, "") || "/";
    const shadowed = reservedPrefixes.find((p) =>
      normalized === p || normalized.startsWith(p + "/")
    );
    if (shadowed) {
      console.warn(
        `[dune] plugin route ${route.path} rejected: shadows reserved prefix ${shadowed}`,
      );
      continue;
    }
    const method = (route.method ?? "GET").toLowerCase() as
      | "get"
      | "post"
      | "put"
      | "delete"
      | "all";
    app[method](route.path, route.handler);
  }
}
