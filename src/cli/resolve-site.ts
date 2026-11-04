/**
 * `--site <id>`: run a command against one site of a multisite install.
 *
 * In multisite each site has its own config, `data_dir`, users and sessions
 * under its own root, so commands that touch that state (`users:*`, `authz:sign`,
 * the `migrate:*` user/auth migrations) must be pointed at one site's root.
 * Run at the install root (the directory holding `config/sites.yaml`), they
 * would otherwise treat the install directory as a site and find nothing, or
 * write into the wrong place.
 *
 * @module
 */

import { loadMultisiteConfig, resolveSiteEntryRoot } from "../multisite/config.ts";

/** Commands whose effect is per site; refused at a multisite install root without `--site`. */
export const SITE_SCOPED_COMMANDS: ReadonlySet<string> = new Set([
  "users:create",
  "users:passwd",
  "users:grant-role",
  "users:revoke-role",
  "authz:sign",
  "migrate:config",
  "migrate:users",
  "migrate:auth-to-db",
  "migrate:roles-to-tuples",
]);

/** Thrown for user errors; the CLI prints the message and exits non-zero. */
export class SiteResolutionError extends Error {
  override name = "SiteResolutionError";
}

/**
 * Directory a command should run in.
 *
 * - `--site <id>` given: the root of that site in `<installRoot>/config/sites.yaml`.
 * - no `--site`, install root is multisite, command is site-scoped: refuse and list the ids.
 * - otherwise: `installRoot` unchanged.
 */
export async function resolveSiteRoot(
  installRoot: string,
  command: string,
  siteId?: string,
): Promise<string> {
  const cfg = await loadMultisiteConfig(installRoot);

  if (siteId !== undefined) {
    if (!cfg) {
      throw new SiteResolutionError(
        `--site ${siteId}: no config/sites.yaml in ${installRoot}, so this is not a multisite install. ` +
          `Run from the install root, or pass --root.`,
      );
    }
    const entry = cfg.sites.find((s) => s.id === siteId);
    if (!entry) {
      throw new SiteResolutionError(
        `Unknown site "${siteId}". Sites in config/sites.yaml: ${
          cfg.sites.map((s) => s.id).join(", ")
        }.`,
      );
    }
    return resolveSiteEntryRoot(installRoot, entry);
  }

  if (cfg && SITE_SCOPED_COMMANDS.has(command)) {
    throw new SiteResolutionError(
      `${installRoot} is a multisite install; ${command} works on one site. ` +
        `Add --site <id> (${cfg.sites.map((s) => s.id).join(", ")}).`,
    );
  }
  return installRoot;
}
