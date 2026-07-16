/**
 * Merging dune's own deno.json with a site's deno.json (site wins).
 *
 * Shared by two callers with the same underlying problem: when the CLI runs
 * from a local source checkout, dune-internal modules are plain file://
 * files with no embedded per-package import map (unlike a JSR-fetched
 * package in production), so any subprocess that loads them under the
 * *site's* --config= alone fails on dune's bare specifiers (@std/path, …).
 *
 *   - cli.ts re-execs the whole CLI with the merged config
 *   - cli/lockfile.ts spawns its discovery helper with the merged config
 *
 * This module must stay free of bare-specifier imports — cli.ts imports it
 * before any import map is guaranteed to be active.
 */

/** Rewrite relative import-map values to absolute file:// URLs so the map
 * stays valid when written to a config file in a different directory. */
export function absolutizeImports(
  imports: Record<string, string>,
  configUrl: URL,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(imports)) {
    out[key] = value.startsWith("./") || value.startsWith("../")
      ? new URL(value, configUrl).href
      : value;
  }
  return out;
}

/**
 * Merge dune's config with the site's (site imports win) into a config
 * object safe to write anywhere — all relative import values are
 * absolutized against their original locations. Throws if either file is
 * unreadable or not JSON; callers decide the fallback.
 */
export async function buildMergedConfig(
  duneConfigPath: string,
  siteConfigPath: string,
): Promise<Record<string, unknown>> {
  const dune = JSON.parse(await Deno.readTextFile(duneConfigPath));
  const site = JSON.parse(await Deno.readTextFile(siteConfigPath));
  const duneUrl = new URL(`file://${duneConfigPath}`);
  const siteUrl = new URL(`file://${siteConfigPath}`);
  return {
    imports: {
      ...absolutizeImports(dune.imports ?? {}, duneUrl),
      ...absolutizeImports(site.imports ?? {}, siteUrl),
    },
    scopes: { ...dune.scopes, ...site.scopes },
    compilerOptions: { ...dune.compilerOptions, ...site.compilerOptions },
    unstable: [...new Set([...(dune.unstable ?? []), ...(site.unstable ?? [])])],
    ...(site.nodeModulesDir ?? dune.nodeModulesDir
      ? { nodeModulesDir: site.nodeModulesDir ?? dune.nodeModulesDir }
      : {}),
  };
}
