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
 * A workspace root ancestor found above dune's own checkout — see
 * `local-checkout-detect.ts`'s `findWorkspaceRoot()`, which produces this.
 * `config.workspace` is carried into the merged config's own `"workspace"`
 * field verbatim (member paths stay relative to `rootDir`), which only
 * resolves if the merged config file itself is later written into
 * `rootDir` — Deno rejects a `"workspace"` array whose members aren't
 * nested under the config file's own directory.
 */
export interface WorkspaceRootInfo {
  rootDir: string;
  config: Record<string, unknown>;
}

/**
 * Merge dune's config with the site's (site imports win), optionally with a
 * workspace root's own config as the lowest-priority layer beneath both —
 * into a config object safe to write anywhere dune's and the site's
 * relative import values are concerned (both get absolutized against their
 * original locations). The workspace root's own relative import values are
 * left as-is: they're only meaningful once written into `workspaceRoot.rootDir`,
 * which is the caller's responsibility when `workspaceRoot` is passed.
 * `siteConfigPath` is optional — omit it when there's no separate site
 * deno.json to merge in (workspace-linking alone is still worth doing).
 * Throws if a required file is unreadable or not JSON; callers decide the
 * fallback.
 */
export async function buildMergedConfig(
  duneConfigPath: string,
  siteConfigPath?: string,
  workspaceRoot?: WorkspaceRootInfo,
): Promise<Record<string, unknown>> {
  const dune = JSON.parse(await Deno.readTextFile(duneConfigPath));
  const site = siteConfigPath
    ? JSON.parse(await Deno.readTextFile(siteConfigPath))
    : {};
  const root = workspaceRoot?.config ?? {};
  const duneUrl = new URL(`file://${duneConfigPath}`);
  const siteUrl = siteConfigPath
    ? new URL(`file://${siteConfigPath}`)
    : duneUrl;

  const merged: Record<string, unknown> = {
    imports: {
      ...(root.imports as Record<string, string> | undefined ?? {}),
      ...absolutizeImports(dune.imports ?? {}, duneUrl),
      ...(siteConfigPath ? absolutizeImports(site.imports ?? {}, siteUrl) : {}),
    },
    scopes: {
      ...(root.scopes as Record<string, unknown> | undefined),
      ...dune.scopes,
      ...site.scopes,
    },
    compilerOptions: {
      ...(root.compilerOptions as Record<string, unknown> | undefined),
      ...dune.compilerOptions,
      ...site.compilerOptions,
    },
    unstable: [
      ...new Set([
        ...(root.unstable as string[] | undefined ?? []),
        ...(dune.unstable ?? []),
        ...(site.unstable ?? []),
      ]),
    ],
    ...(site.nodeModulesDir ?? dune.nodeModulesDir ?? root.nodeModulesDir
      ? {
        nodeModulesDir: site.nodeModulesDir ?? dune.nodeModulesDir ??
          root.nodeModulesDir,
      }
      : {}),
    // Deno only accepts this field in a workspace-root config, which the
    // merged temp config always is (see the module doc) — dropping it here
    // silently disabled a site's own opt-out of the 24h default freshness
    // window for its own first-party package pins.
    ...(site.minimumDependencyAge ?? dune.minimumDependencyAge ??
        root.minimumDependencyAge
      ? {
        minimumDependencyAge: site.minimumDependencyAge ??
          dune.minimumDependencyAge ?? root.minimumDependencyAge,
      }
      : {}),
  };

  if (workspaceRoot && Array.isArray(workspaceRoot.config.workspace)) {
    merged.workspace = workspaceRoot.config.workspace;
  }

  return merged;
}
