/**
 * Plugin system — public API for plugin loading and management.
 *
 * ## Stability
 *
 * The following exports are STABLE as of v0.3 and follow semver:
 *   - PLUGIN_API_VERSION constant
 *   - DunePlugin interface (src/hooks/types.ts)
 *   - HookEvent and HookContext types (src/hooks/types.ts)
 *   - PluginApi interface (src/hooks/types.ts)
 *   - loadPlugins / loadPluginAdminConfigs functions
 *
 * Breaking changes to these exports will only occur in major version bumps.
 */

/**
 * Current plugin API version. Plugin authors can check this at runtime to
 * conditionally enable features or warn about incompatibility:
 *
 *   import { PLUGIN_API_VERSION } from "jsr:@dune-cms/core/plugins";
 *   if (PLUGIN_API_VERSION !== "0.3") console.warn("Unexpected API version");
 */
export const PLUGIN_API_VERSION = "0.3";

export { loadPlugins, loadPluginAdminConfigs } from "./loader.ts";
export type { PluginLoaderOptions } from "./loader.ts";
