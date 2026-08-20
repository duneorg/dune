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
 * ## Changes in v0.17
 *
 * - `DunePlugin.adminServices` — plugins can contribute admin-context services
 *   (e.g. inline editing manager). Factory called during bootstrap with storage,
 *   history, and path context. See `AdminServicesContext` / `AdminServices`.
 * - `collectAdminServices` — collects and merges admin services from all plugins.
 * - `DunePlugin.transformResponse` — plugins can transform HTTP responses before
 *   they are sent to the client. Auth and the matched content page are pre-resolved
 *   by core. See `ResponseTransformContext` and `applyResponseTransforms`.
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
 * ## Trust model — read carefully
 *
 * Plugins are loaded via dynamic `import()` and execute in the same Deno
 * process as the host with the same permissions. **Installing a plugin is
 * equivalent to granting full administrative access to the site.**
 *
 * Specifically:
 *
 * - Plugins can read and write any file the Deno process can.
 * - The `onRequest` hook receives a sanitized `Request` with `Cookie` and
 *   `Authorization` headers stripped, and any `Set-Cookie` headers in
 *   plugin-returned responses on admin paths are dropped. This is a
 *   defence-in-depth measure — it does not prevent a hostile plugin from
 *   reading sessions through other means (e.g. monkey-patching globals).
 *   Treat plugins as fully trusted regardless.
 * - Site administrators should only install plugins from sources they
 *   review or trust the same way they trust their own code.
 *
 * @example
 * ```ts
 * import { PLUGIN_API_VERSION } from "@dune/core/plugins";
 * if (PLUGIN_API_VERSION !== "0.7") console.warn("Unexpected API version");
 * ```
 *
 * @since 0.6.0
 */

import denoJson from "../../deno.json" with { type: "json" };

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
export const PLUGIN_API_VERSION = "0.7";

/**
 * The version of this loaded `@dune/core` module instance.
 * @since 0.31.0
 */
export const CORE_VERSION: string = denoJson.version;

/**
 * Identity sentinel for this loaded copy of `@dune/core`.
 *
 * Compared **by reference** (`===`) to detect the same package being resolved
 * into a process twice — e.g. a plugin whose `@dune/core` version range the
 * host site's pinned version can't satisfy, or a site running core from a
 * local path while a plugin resolves it from JSR. Version strings can't catch
 * the latter case (both copies may report the same version); module identity
 * catches both. `@dune/plugin-admin` re-exports the sentinel it resolved so
 * `bootstrap()` can verify both landed on one instance.
 *
 * @since 0.31.0
 */
export const CORE_INSTANCE: Readonly<Record<never, never>> = Object.freeze({});

export { loadPlugins, loadPluginAdminConfigs, collectAdminServices, applyResponseTransforms, mountPlugins } from "./loader.ts";
export type { PluginLoaderOptions } from "./loader.ts";
export type {
  /** A button contributed to the shared admin bar UI via `DunePlugin.adminBarActions`. */
  AdminBarAction,
  /** Context passed to {@link DunePlugin.adminBarActions}. */
  AdminBarActionContext,
  /** A custom admin page contributed by a plugin. Registered via `DunePlugin.adminPages`. */
  AdminPageRegistration,
  /** Admin-panel services contributed by a plugin via {@link DunePlugin.adminServices}. */
  AdminServices,
  /** Context passed to {@link DunePlugin.adminServices} factories. */
  AdminServicesContext,
  /** A Dune plugin — a plain object (or factory return value) registering hook handlers and optional admin pages, schemas, and static assets. */
  DunePlugin,
  /** Context passed to each hook handler */
  HookContext,
  /** All lifecycle events a plugin can subscribe to. Frozen since v0.6.0. */
  HookEvent,
  /** Hook handler signature */
  HookHandler,
  /** API surface passed to a plugin's setup() function. */
  PluginApi,
  /** A public-facing route contributed by a plugin via `DunePlugin.publicRoutes`. */
  PublicRouteRegistration,
  /** Context passed to {@link DunePlugin.transformResponse}. */
  ResponseTransformContext,
} from "../hooks/types.ts";
export type {
  /** Plugin-provided replacement for the built-in block editor. Register via {@link AdminServices.contentEditor}. */
  ContentEditorPlugin,
  /** Passed to {@link DunePlugin.mount} — provides everything a plugin needs to register Fresh routes and wire up runtime services. */
  MountApi,
} from "../hooks/types.ts";
