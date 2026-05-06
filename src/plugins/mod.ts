/**
 * Dune plugin system — public API for plugin loading and management.
 *
 * @module
 *
 * ## Stability guarantee (v0.6+)
 *
 * The following are **frozen** as of v0.6.0 and will not change before v1.0:
 *
 * - `PLUGIN_API_VERSION` — runtime version constant
 * - `DunePlugin` interface (defined in `@dune/core`)
 * - `HookEvent` union (additive only — new events may be added in minor versions)
 * - `HookContext` interface
 * - `PluginApi` interface
 * - `loadPlugins` / `loadPluginAdminConfigs` functions
 *
 * ## Changes in v1.1
 *
 * - `DunePlugin.publicRoutes` — plugins can now register public-facing Fresh routes.
 *   Each entry registers a programmatic route before the content catch-all. Plugins
 *   get `ctx.render()`, islands, and middleware — no manual URL matching needed.
 *   See `PublicRouteRegistration` for the full type.
 *
 * ## Changes in v0.7
 *
 * - `DunePlugin.adminPages` — plugins can now register custom admin panel pages.
 *   Each entry adds a programmatic route under the admin prefix and an optional
 *   sidebar link. See `AdminPageRegistration` for the full type.
 *
 * @example
 * ```ts
 * import { PLUGIN_API_VERSION } from "@dune/core/plugins";
 * if (PLUGIN_API_VERSION !== "0.7") console.warn("Unexpected API version");
 * ```
 *
 * @since 0.6.0
 */

/**
 * Current plugin API version.
 *
 * Plugin authors should check this at load time and warn (not error) if it
 * doesn't match the version they were written against. The minor component
 * may advance when new hook events are added; the major component advances
 * only on breaking changes.
 *
 * @since 0.3.0
 */
export const PLUGIN_API_VERSION = "1.1";

export { loadPlugins, loadPluginAdminConfigs } from "./loader.ts";
export type { PluginLoaderOptions } from "./loader.ts";
export type { PublicRouteRegistration } from "../hooks/types.ts";
