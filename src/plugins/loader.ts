/**
 * Plugin loader — dynamically imports and registers plugins listed in
 * DuneConfig.pluginList.
 *
 * Plugin module contract
 * ----------------------
 * A plugin module must export a `DunePlugin` as its default export, either
 * as a plain object or as a factory function:
 *
 *   // Object form (no config needed):
 *   export default { name: "my-plugin", version: "1.0.0", hooks: { ... } };
 *
 *   // Factory form (receives merged plugin config):
 *   export default function createPlugin(config: MyConfig): DunePlugin { ... }
 *
 * When the factory form is used, the function receives the merged plugin config
 * (static config from site.yaml merged with admin-saved config overrides).
 *
 * Plugin source forms
 * -------------------
 *   Local:   "./plugins/my-plugin.ts"   (relative to site root)
 *   JSR:     "jsr:@scope/plugin-name"
 *   npm:     "npm:dune-plugin-name"
 *   HTTPS:   "https://example.com/plugin.ts"
 */

import { join } from "@std/path";
import type { DuneConfig, PluginEntry } from "../config/types.ts";
import type { DunePlugin } from "../hooks/types.ts";
import type { HookRegistry } from "../hooks/types.ts";
import type { StorageAdapter } from "../storage/types.ts";

export interface PluginLoaderOptions {
  config: DuneConfig;
  hooks: HookRegistry;
  storage: StorageAdapter;
  /** Absolute path to the site root directory */
  root: string;
}

/**
 * Scan `{root}/plugins/` for `.ts` files not starting with `_` and return
 * synthetic `PluginEntry[]` for those not already listed in `existing`.
 *
 * This allows themes/sites to drop plugin files into a `plugins/` directory
 * without explicitly listing them in `site.yaml`.
 */
async function discoverLocalPlugins(
  root: string,
  storage: StorageAdapter,
  existing: PluginEntry[],
): Promise<PluginEntry[]> {
  const pluginsDir = `${root}/plugins`;
  const dirExists = await storage.exists(pluginsDir);
  if (!dirExists) return [];

  let entries: Awaited<ReturnType<StorageAdapter["list"]>>;
  try {
    entries = await storage.list(pluginsDir);
  } catch {
    return [];
  }

  // Normalise the set of already-configured local sources so we can dedup.
  const existingSrcs = new Set(existing.map((e) => e.src));

  const discovered: PluginEntry[] = [];
  for (const entry of entries) {
    if (!entry.name.endsWith(".ts") || entry.name.startsWith("_")) continue;
    const src = `./plugins/${entry.name}`;
    if (!existingSrcs.has(src)) {
      discovered.push({ src });
    }
  }

  return discovered;
}

/**
 * Load and register all plugins declared in config.pluginList, plus any
 * plugins auto-discovered in the site's `plugins/` directory.
 *
 * For each plugin entry:
 *  1. Resolve the import URL (local → file://, registry → pass-through)
 *  2. Dynamically import the module
 *  3. Extract the default export (plain DunePlugin or factory function)
 *  4. If factory: pass merged plugin config to it
 *  5. Merge PluginEntry.config into DuneConfig.plugins[plugin.name]
 *  6. Call hooks.registerPlugin(plugin)
 */
export async function loadPlugins(options: PluginLoaderOptions): Promise<void> {
  const { config, hooks, root, storage } = options;

  const configured = config.pluginList ?? [];
  // Auto-discovery is opt-in — loading an arbitrary `.ts` file out of
  // `plugins/` executes its module code at startup. Sites that want the
  // drop-in workflow must set `autoDiscoverPlugins: true` in site.yaml.
  const discovered = config.autoDiscoverPlugins
    ? await discoverLocalPlugins(root, storage, configured)
    : [];

  // Discovered plugins load first (lowest priority) so explicit config wins.
  const allEntries = [...discovered, ...configured];
  if (allEntries.length === 0) return;

  for (const entry of allEntries) {
    try {
      const importUrl = resolvePluginUrl(entry.src, root);
      const mod = await import(importUrl);

      const exported = mod.default;
      if (!exported) {
        console.warn(`[dune] Plugin at "${entry.src}" has no default export — skipped`);
        continue;
      }

      let plugin: DunePlugin;

      if (typeof exported === "function") {
        // Factory form — merge static entry config over any existing plugin config
        const pluginCfg = {
          ...(config.plugins[exported.pluginName ?? ""] ?? {}),
          ...(entry.config ?? {}),
        };
        plugin = await exported(pluginCfg);
      } else if (typeof exported === "object") {
        plugin = exported as DunePlugin;
      } else {
        console.warn(
          `[dune] Plugin at "${entry.src}" default export must be an object or function — skipped`,
        );
        continue;
      }

      if (!plugin.name || !plugin.version) {
        console.warn(
          `[dune] Plugin at "${entry.src}" is missing required "name" or "version" — skipped`,
        );
        continue;
      }

      // Auto-detect assets/ and templates/ subdirs for local plugins.
      // Registry/HTTPS plugins don't have a known filesystem path, so we
      // only do this for local "./plugins/..." sources.
      if (entry.src.startsWith(".") || entry.src.startsWith("/")) {
        const pluginDir = join(root, entry.src.replace(/\/mod\.ts$/, "").replace(/\.ts$/, ""));
        const assetsDir = join(pluginDir, "assets");
        const templatesDir = join(pluginDir, "templates");
        try {
          const assetsStat = await Deno.stat(assetsDir);
          if (assetsStat.isDirectory) plugin.assetDir = assetsDir;
        } catch { /* no assets dir */ }
        try {
          const templatesStat = await Deno.stat(templatesDir);
          if (templatesStat.isDirectory) plugin.templateDir = templatesDir;
        } catch { /* no templates dir */ }
      }

      // Merge the static entry config into config.plugins[name] so it's
      // accessible inside hook handlers via ctx.config.plugins[name].
      if (entry.config && Object.keys(entry.config).length > 0) {
        config.plugins[plugin.name] = {
          ...(config.plugins[plugin.name] ?? {}),
          ...entry.config,
        };
      }

      hooks.registerPlugin(plugin);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[dune] Failed to load plugin "${entry.src}": ${message}`);
      // Non-fatal — continue loading remaining plugins
    }
  }

  // Validate plugin dependencies — warn (non-fatal) for missing deps.
  const loadedNames = new Set(hooks.plugins().map((p) => p.name));
  for (const plugin of hooks.plugins()) {
    if (!plugin.dependencies || plugin.dependencies.length === 0) continue;
    for (const dep of plugin.dependencies) {
      if (!loadedNames.has(dep)) {
        console.warn(
          `[dune] Plugin "${plugin.name}" depends on "${dep}", which is not installed.`,
        );
      }
    }
  }
}

/**
 * Load persisted admin-saved plugin config overrides and merge them into
 * config.plugins.  Called before loadPlugins so factory functions receive
 * the most up-to-date config.
 */
export async function loadPluginAdminConfigs(
  config: DuneConfig,
  storage: StorageAdapter,
  dataDir: string,
): Promise<void> {
  const pluginsDir = `${dataDir}/plugins`;
  const exists = await storage.exists(pluginsDir);
  if (!exists) return;

  try {
    const entries = await storage.list(pluginsDir);
    for (const entry of entries) {
      if (!entry.name.endsWith(".json")) continue;
      const pluginName = entry.name.slice(0, -5); // strip .json
      try {
        const raw = await storage.readText(`${pluginsDir}/${entry.name}`);
        const saved = JSON.parse(raw) as Record<string, unknown>;
        // Admin-saved config wins over site.yaml static config
        config.plugins[pluginName] = {
          ...(config.plugins[pluginName] ?? {}),
          ...saved,
        };
      } catch {
        // Ignore malformed plugin config files — plugin will use defaults
      }
    }
  } catch {
    // Directory not listable — ignore
  }
}

/**
 * Resolve a plugin source string to an importable URL.
 *
 * - `jsr:`, `npm:`, `https:` — returned as-is (Deno handles them)
 * - Local path starting with `.` or `/` — converted to `file://` URL
 * - Anything else — returned as-is and let Deno resolve it
 */
function resolvePluginUrl(src: string, root: string): string {
  if (
    src.startsWith("jsr:") ||
    src.startsWith("npm:") ||
    src.startsWith("https:") ||
    src.startsWith("http:")
  ) {
    return src;
  }

  // Local path — resolve relative to site root
  const absPath = src.startsWith("/") ? src : join(root, src);
  return `file://${absPath}`;
}
