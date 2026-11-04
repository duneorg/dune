/**
 * Reading `config/sites.yaml` — kept apart from {@link MultisiteManager} so the
 * CLI can resolve a site without importing the whole server stack.
 *
 * @module
 */

import { isAbsolute, join, resolve } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import type { MultisiteConfig, SiteEntry } from "../config/types.ts";

/**
 * Parse `{installRoot}/config/sites.yaml`.
 * Returns null if the file does not exist.
 */
export async function loadMultisiteConfig(
  installRoot: string,
): Promise<MultisiteConfig | null> {
  const cfgPath = join(installRoot, "config", "sites.yaml");
  let raw: string;
  try {
    raw = await Deno.readTextFile(cfgPath);
  } catch {
    return null;
  }

  const parsed = parseYaml(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`[dune/multisite] Invalid config/sites.yaml: expected a mapping`);
  }

  const data = parsed as Record<string, unknown>;

  const rawSites = data.sites;
  if (!Array.isArray(rawSites) || rawSites.length === 0) {
    throw new Error(`[dune/multisite] config/sites.yaml must contain a non-empty "sites" array`);
  }

  const sites: SiteEntry[] = rawSites.map((raw, i) => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new Error(`[dune/multisite] sites[${i}] is not an object`);
    }
    const entry = raw as Record<string, unknown>;
    if (!entry.id || typeof entry.id !== "string") {
      throw new Error(`[dune/multisite] sites[${i}] missing or invalid "id" field`);
    }
    if (!entry.root || typeof entry.root !== "string") {
      throw new Error(`[dune/multisite] sites[${i}] (${entry.id}) missing or invalid "root" field`);
    }
    if (entry.hostname && entry.path_prefix) {
      throw new Error(
        `[dune/multisite] sites[${i}] (${entry.id}): "hostname" and "path_prefix" are mutually exclusive`,
      );
    }
    return {
      id: entry.id,
      root: entry.root,
      hostname: typeof entry.hostname === "string" ? entry.hostname : undefined,
      pathPrefix: typeof entry.path_prefix === "string" ? entry.path_prefix : undefined,
      default: entry.default === true,
    };
  });

  return {
    sites,
    sharedThemesDir: typeof data.shared_themes_dir === "string"
      ? data.shared_themes_dir
      : undefined,
    sharedPluginsDir: typeof data.shared_plugins_dir === "string"
      ? data.shared_plugins_dir
      : undefined,
  };
}

/**
 * Absolute root directory of a site entry. Relative roots resolve against the
 * `config/` directory that holds `sites.yaml`, exactly as the manager does.
 */
export function resolveSiteEntryRoot(
  installRoot: string,
  entry: SiteEntry,
): string {
  return isAbsolute(entry.root)
    ? entry.root
    : resolve(join(installRoot, "config"), entry.root);
}
