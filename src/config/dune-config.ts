/**
 * Top-level DuneConfig assembly type and PluginEntry.
 */

import type { SiteConfig } from "./site-config.ts";
import type { SystemConfig, ThemeConfig } from "./system-config.ts";
import type { AdminConfig } from "./admin-config.ts";

/**
 * A single plugin entry declared in site.yaml under the `plugins:` key.
 *
 * @example Local plugin
 * ```yaml
 * plugins:
 *   - src: "./plugins/my-plugin.ts"
 * ```
 *
 * @example JSR plugin with config
 * ```yaml
 * plugins:
 *   - src: "jsr:@dune/plugin-seo"
 *     config:
 *       defaultDescription: "My site"
 * ```
 */
export interface PluginEntry {
  /**
   * Module source — local path or registry specifier.
   *
   * Supported forms:
   *   - `"./plugins/my-plugin.ts"` — relative to site root
   *   - `"jsr:@scope/plugin-name"` — JSR package
   *   - `"npm:dune-plugin-name"` — npm package (via Deno's npm: specifier)
   *   - `"https://example.com/plugin.ts"` — remote URL
   */
  src: string;
  /**
   * Static config for this plugin.
   * Merged into DuneConfig.plugins[plugin.name] and readable by the plugin
   * via ctx.config.plugins[name] inside hook handlers.
   */
  config?: Record<string, unknown>;
}

/** Top-level Dune configuration (result of merging all config sources) */
export interface DuneConfig {
  site: SiteConfig;
  system: SystemConfig;
  theme: ThemeConfig;
  /**
   * Plugin runtime configs — keyed by plugin name.
   * Populated from PluginEntry.config declarations at load time, then
   * overridable via the admin config form for plugins with a configSchema.
   */
  plugins: Record<string, Record<string, unknown>>;
  /**
   * Ordered list of plugins to load.
   * Declared in site.yaml under the `plugins:` key.
   */
  pluginList: PluginEntry[];
  /**
   * Auto-discover and load any `.ts` files in the site's `plugins/` directory
   * that are not already listed in `pluginList`.
   *
   * Default: `false`. Auto-discovery executes arbitrary TypeScript at startup,
   * so opting in is required — rely on explicit entries in `site.yaml` unless
   * you have a trusted local workflow that expects drop-in plugin files.
   */
  autoDiscoverPlugins?: boolean;
  /** Admin panel configuration (optional — defaults applied if omitted) */
  admin?: AdminConfig;
}
