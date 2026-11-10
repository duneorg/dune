/**
 * Config loader — loads and merges configuration from all sources.
 *
 * Loading order (most specific wins):
 *   1. System defaults (hardcoded)
 *   2. config/system.yaml + config/site.yaml
 *   3. config/env/{DUNE_ENV}/*.yaml (environment-specific)
 *   4. dune.config.ts (programmatic overrides)
 *   5. Page frontmatter (handled at render time, not here)
 */

import {
  describeLegacyKeys,
  describeMovedKeys,
  findIgnoredKeys,
  findLegacyKeys,
  findMovedKeys,
} from "./legacy-keys.ts";
import { parse as parseYaml } from "@std/yaml";
import { join, normalize, resolve } from "@std/path";
import { ConfigError } from "../core/errors.ts";
import { logger } from "../core/logger.ts";
import type { StorageAdapter } from "../storage/types.ts";
import type { DuneConfig } from "./types.ts";
import { DEFAULT_CONFIG } from "./defaults.ts";
import { validateConfig } from "./validator.ts";

/** Ignored-key warnings already logged, so a reload (dev watch) does not repeat them. */
const warnedIgnored = new Set<string>();

/**
 * Keys whose value an override replaces whole instead of merging into. A mapping
 * that is a complete answer (`system.role_grants`: which groups hold which
 * relation) means "exactly this" in an environment overlay; merged key by key,
 * an overlay `role_grants: {}` could never switch the base's grants off.
 */
const REPLACED_KEYS = new Set(["role_grants"]);

/**
 * Deep merge two objects.  Arrays are replaced, not concatenated, and so are
 * the values under {@link REPLACED_KEYS}.
 *
 * @param depth  Internal recursion depth guard — callers should not pass this.
 *   Limits recursion to 20 levels to prevent a stack overflow from
 *   accidentally circular or deeply-nested config objects.
 */
export function deepMerge<T extends Record<string, unknown>>(
  base: T,
  override: Record<string, unknown>,
  depth = 0,
): T {
  if (depth > 20) {
    // Depth limit reached — treat override value as opaque (no deeper merge).
    return override as unknown as T;
  }

  const result = { ...base } as Record<string, unknown>;

  for (const key of Object.keys(override)) {
    const baseVal = result[key];
    const overVal = override[key];

    if (
      !REPLACED_KEYS.has(key) &&
      overVal !== null &&
      typeof overVal === "object" &&
      !Array.isArray(overVal) &&
      baseVal !== null &&
      typeof baseVal === "object" &&
      !Array.isArray(baseVal)
    ) {
      result[key] = deepMerge(
        baseVal as Record<string, unknown>,
        overVal as Record<string, unknown>,
        depth + 1,
      );
    } else {
      result[key] = overVal;
    }
  }

  return result as T;
}

/**
 * Detect the current environment.
 *
 * Priority:
 *   1. DUNE_ENV environment variable
 *   2. DENO_DEPLOYMENT_ID exists → "production"
 *   3. Default: "development"
 */
export function detectEnvironment(): string {
  const duneEnv = Deno.env.get("DUNE_ENV");
  if (duneEnv) return duneEnv;

  if (Deno.env.get("DENO_DEPLOYMENT_ID")) return "production";

  return "development";
}

/** Try to load and parse a YAML file. Returns empty object if not found. */
async function loadYamlFile(
  storage: StorageAdapter,
  path: string,
): Promise<Record<string, unknown>> {
  try {
    const exists = await storage.exists(path);
    if (!exists) return {};

    const text = await storage.readText(path);
    if (!text.trim()) return {};

    const parsed = parseYaml(text);
    if (parsed === null || parsed === undefined) return {};
    if (typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ConfigError(
        `Expected an object but got ${Array.isArray(parsed) ? "an array" : typeof parsed}`,
        path,
      );
    }
    const kind = path.endsWith("/site.yaml") ? "site" : path.endsWith("/system.yaml") ? "system" : null;
    if (kind) {
      const legacy = findLegacyKeys(kind, parsed);
      const moved = findMovedKeys(kind, parsed);
      if (legacy.length > 0 || moved.length > 0) {
        const parts = [
          legacy.length > 0 ? `renamed to snake_case: ${describeLegacyKeys(legacy)}` : "",
          moved.length > 0 ? `moved or removed: ${describeMovedKeys(moved)}` : "",
        ].filter(Boolean);
        const hints = [
          legacy.length > 0 ? "Run `dune migrate:config` to rename the renamed keys." : "",
          moved.length > 0 ? "Move the moved or removed keys by hand." : "",
        ].filter(Boolean);
        throw new ConfigError(
          `Config keys changed: ${parts.join("; ")}. ${hints.join(" ")}`,
          path,
        );
      }
      for (const k of findIgnoredKeys(kind, parsed)) {
        const id = `${path}:${k.path}`;
        if (warnedIgnored.has(id)) continue;
        warnedIgnored.add(id);
        logger.warn("config.key.ignored", {
          file: path,
          key: k.path,
          reason: k.to,
          hint: "Setting it changes nothing; `dune migrate:config` removes it.",
        });
      }
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    if (err instanceof ConfigError) throw err;
    throw new ConfigError(`Failed to parse YAML: ${err}`, path);
  }
}

/** Try to load dune.config.ts programmatic config. */
async function loadConfigTs(
  rootDir: string,
): Promise<Record<string, unknown>> {
  // Resolve to absolute path so the path escape check works correctly
  // regardless of whether rootDir is relative (e.g. ".") or absolute.
  const absRoot = resolve(rootDir);
  const configPath = join(absRoot, "dune.config.ts");

  // Defense-in-depth: verify the resolved path stays within rootDir.
  const normalizedRoot = normalize(absRoot);
  const normalizedConfig = normalize(configPath);
  if (
    normalizedConfig !== `${normalizedRoot}/dune.config.ts` &&
    normalizedConfig !== `${normalizedRoot}\\dune.config.ts`
  ) {
    throw new ConfigError(
      "dune.config.ts path escapes site root — refusing to load",
      configPath,
    );
  }

  try {
    await Deno.stat(configPath);
  } catch {
    return {};
  }

  try {
    // Use file:// URL for dynamic import (Deno requires it)
    const fileUrl = `file://${configPath}`;
    const mod = await import(fileUrl); // lockfile-safe: site-local (dune.config.ts, resolved to file:// URL)

    // Support both default export and named "config" export
    const config = mod.default ?? mod.config;
    if (!config) return {};

    // Config can be a function (for async config) or plain object
    const resolved = typeof config === "function" ? await config() : config;

    if (typeof resolved !== "object" || Array.isArray(resolved) || resolved === null) {
      throw new ConfigError(
        "dune.config.ts must export an object (or a function returning one)",
        configPath,
      );
    }

    return resolved as Record<string, unknown>;
  } catch (err) {
    if (err instanceof ConfigError) throw err;
    throw new ConfigError(
      `Failed to load dune.config.ts: ${err}`,
      configPath,
    );
  }
}

export interface LoadConfigOptions {
  /** Storage adapter for reading YAML config files */
  storage: StorageAdapter;
  /** Root directory of the site (for dune.config.ts resolution) */
  rootDir: string;
  /** Override environment detection */
  env?: string;
  /** Skip dune.config.ts loading (useful for testing) */
  skipConfigTs?: boolean;
  /** Skip validation (useful for debugging) */
  skipValidation?: boolean;
}

/**
 * Load and merge configuration from all sources.
 * Returns a fully resolved DuneConfig object.
 */
export async function loadConfig(options: LoadConfigOptions): Promise<DuneConfig> {
  const {
    storage,
    rootDir,
    env: envOverride,
    skipConfigTs = false,
    skipValidation = false,
  } = options;

  const environment = envOverride ?? detectEnvironment();

  // --- Layer 1: System defaults ---
  let config = structuredClone(DEFAULT_CONFIG) as unknown as Record<string, unknown>;

  // --- Layer 2: config/site.yaml + config/system.yaml ---
  const [siteYaml, systemYaml] = await Promise.all([
    loadYamlFile(storage, "config/site.yaml"),
    loadYamlFile(storage, "config/system.yaml"),
  ]);

  // Extract top-level keys from site.yaml — theme, plugins (list), and
  // plugin_configs (per-plugin config map) are promoted to DuneConfig
  // top-level rather than nested under "site".
  const themeFromSite = siteYaml.theme;
  const themeListFromSite = siteYaml.themes;
  const pluginListFromSite = siteYaml.plugins;    // PluginEntry[]
  const pluginCfgsFromSite = siteYaml.plugin_configs; // Record<name, config>
  const autoDiscoverFromSite = siteYaml.auto_discover_plugins; // boolean
  const siteWithoutTop = { ...siteYaml };
  delete siteWithoutTop.theme;
  delete siteWithoutTop.themes;
  delete siteWithoutTop.plugins;
  delete siteWithoutTop.plugin_configs;
  delete siteWithoutTop.auto_discover_plugins;

  // site.yaml values go under the "site" key (except promoted top-level keys)
  if (Object.keys(siteWithoutTop).length > 0) {
    config = deepMerge(config, { site: siteWithoutTop });
  }

  // Theme config goes at top level
  if (themeFromSite) {
    config = deepMerge(config, { theme: themeFromSite });
  }

  if (Array.isArray(themeListFromSite) && themeListFromSite.length > 0) {
    (config as Record<string, unknown>).themeList = themeListFromSite;
  }

  // Plugin list — replace default empty array (arrays are replaced, not merged)
  if (Array.isArray(pluginListFromSite) && pluginListFromSite.length > 0) {
    (config as Record<string, unknown>).pluginList = pluginListFromSite;
  }

  if (typeof autoDiscoverFromSite === "boolean") {
    (config as Record<string, unknown>).autoDiscoverPlugins = autoDiscoverFromSite;
  }

  // Explicit per-plugin config overrides (Record<name, Record<k,v>>)
  if (pluginCfgsFromSite && typeof pluginCfgsFromSite === "object" && !Array.isArray(pluginCfgsFromSite)) {
    config = deepMerge(config, { plugins: pluginCfgsFromSite });
  }

  if (Object.keys(systemYaml).length > 0) {
    config = deepMerge(config, { system: systemYaml });
  }

  // --- Layer 3: Environment-specific overrides ---
  const envDir = `config/env/${environment}`;
  const [envSiteYaml, envSystemYaml] = await Promise.all([
    loadYamlFile(storage, `${envDir}/site.yaml`),
    loadYamlFile(storage, `${envDir}/system.yaml`),
  ]);

  if (Object.keys(envSiteYaml).length > 0) {
    config = deepMerge(config, { site: envSiteYaml });
  }
  if (Object.keys(envSystemYaml).length > 0) {
    config = deepMerge(config, { system: envSystemYaml });
  }

  // --- Layer 4: dune.config.ts ---
  if (!skipConfigTs) {
    const tsConfig = await loadConfigTs(rootDir);
    if (Object.keys(tsConfig).length > 0) {
      config = deepMerge(config, tsConfig);
    }
  }

  // Layer 5 (page frontmatter) is applied at render time, not here.

  const duneConfig = config as unknown as DuneConfig;

  // --- Validate ---
  if (!skipValidation) {
    const errors = validateConfig(duneConfig);
    if (errors.length > 0) {
      throw new ConfigError(
        `Invalid configuration:\n${errors.map((e) => `  → ${e}`).join("\n")}`,
      );
    }
  }

  return duneConfig;
}
