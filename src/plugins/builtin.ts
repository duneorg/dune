/**
 * Registry specifiers for the built-in admin plugin.
 *
 * These are imported at runtime via *variable-argument* dynamic `import()`
 * (bootstrap.ts, multisite/manager.ts) to break the circular publish-time
 * dependency between @dune/core and @dune/plugin-admin — which means Deno's
 * module-graph builder cannot follow them statically, so `deno cache
 * <core>/cli` never records them and `dune lockfile:sync` would produce a
 * lockfile that a `--frozen` serve rejects the moment bootstrap loads the
 * admin plugin. The lockfile discovery helper therefore reports these
 * specifiers explicitly for admin-enabled sites.
 *
 * Keep every variable-imported external specifier defined HERE and consumed
 * from here by both the runtime import site and lockfile-resolve-helper.ts —
 * an inline string at the import site silently reopens the lockfile gap.
 */

import { CORE_INSTANCE, CORE_VERSION } from "./mod.ts";
import { DEFAULT_CONFIG } from "../config/defaults.ts";
import type { DuneConfig } from "../config/types.ts";

/**
 * The built-in admin plugin package (bootstrap.ts's dynamic import).
 *
 * The range is deliberately `*`: `jsr:` specifiers cannot express "3.x or 4.x",
 * and 0.36 has to keep resolving while `@dune/plugin-admin` 4.0.0 (which reads
 * the snake_case config keys) is not yet published, then pick it up the moment
 * it is. {@link checkAdminVersion} is the real guard: bootstrap refuses an admin
 * below {@link MIN_ADMIN_MAJOR} when the site sets a renamed admin key, so a
 * stale lockfile or cache can never run the old camelCase reader against a
 * snake_case `DuneConfig` and drop settings unnoticed. Tighten to `^4` in
 * the release after admin 4.0.0 ships.
 */
export const ADMIN_PLUGIN_SPECIFIER = "jsr:@dune/plugin-admin@*";

/** Oldest `@dune/plugin-admin` major that reads the 0.36 snake_case config keys. */
export const MIN_ADMIN_MAJOR = 4;

/**
 * Admin-read settings that 0.36 renamed to snake_case and that the site has
 * moved off their defaults. Empty when the site configures none of them.
 *
 * An admin plugin older than {@link MIN_ADMIN_MAJOR} still reads the camelCase
 * properties, which are now `undefined`, so it falls back to its own defaults.
 * That is harmless for a site on all defaults but silently drops any value the
 * site set (`runtime_dir`, `authz_store: db`, ...).
 */
export function adminSettingsAtRisk(config: DuneConfig): string[] {
  const out: string[] = [];
  const admin = (config.admin ?? {}) as unknown as Record<string, unknown>;
  const defaults = DEFAULT_CONFIG.admin as unknown as Record<string, unknown>;
  for (
    const key of [
      "session_lifetime",
      "runtime_dir",
      "max_upload_mb",
      "authz_store",
    ]
  ) {
    if (
      admin[key] !== undefined &&
      JSON.stringify(admin[key]) !== JSON.stringify(defaults[key])
    ) {
      out.push(`admin.${key}`);
    }
  }
  const audit = admin.audit as Record<string, unknown> | undefined;
  if (audit?.log_file !== undefined) out.push("admin.audit.log_file");
  if (admin.auth_provider !== undefined) out.push("admin.auth_provider");
  const tsx = config.system?.content?.allow_tsx_format;
  if (
    tsx !== undefined &&
    JSON.stringify(tsx) !==
      JSON.stringify(DEFAULT_CONFIG.system.content?.allow_tsx_format)
  ) {
    out.push("content.allow_tsx_format");
  }
  return out;
}

/**
 * Outcome of checking the resolved admin plugin against the snake_case config:
 * `ok` (new enough, or version unreadable — never treated as old), `warn` (old,
 * but the site sets nothing it would drop), or `refuse` (old and it would
 * silently ignore the listed settings). `message` is set unless `ok`.
 */
export function checkAdminVersion(
  version: unknown,
  config: DuneConfig,
): { level: "ok" | "warn" | "refuse"; message?: string } {
  if (typeof version !== "string") return { level: "ok" };
  const major = Number.parseInt(version.split(".")[0], 10);
  if (!Number.isFinite(major) || major >= MIN_ADMIN_MAJOR) {
    return { level: "ok" };
  }
  const atRisk = adminSettingsAtRisk(config);
  const base =
    `[dune] @dune/plugin-admin@${version} predates the snake_case config keys ` +
    `(@dune/core ${CORE_VERSION} wants @dune/plugin-admin ${MIN_ADMIN_MAJOR}.x or newer)`;
  if (atRisk.length === 0) {
    return {
      level: "warn",
      message:
        `${base}; no admin setting is customised, so it runs on defaults.`,
    };
  }
  return {
    level: "refuse",
    message: `${base}, and would silently ignore: ${atRisk.join(", ")}. ` +
      `Update the plugin (\`dune lockfile:sync\` refreshes a stale deno.lock) or remove those settings.`,
  };
}

/** The admin mount subpath used by the multisite manager. */
export const ADMIN_MOUNT_SPECIFIER = "jsr:@dune/plugin-admin@*/admin/mount";

/**
 * Core-instance handshake for the dynamically imported admin plugin.
 *
 * `@dune/plugin-admin` (≥1.1.3) re-exports the `CORE_INSTANCE` sentinel and
 * `CORE_VERSION` it resolved from its own `@dune/core` dependency. If that
 * sentinel is not reference-equal to ours, the resolver loaded a second copy
 * of core into this process — module-level singletons are split and the admin
 * surface runs different core code than the site. Should never happen with
 * the plugin's floating `@0` range; this exists to catch the day that silently
 * stops being true (a range regression, a yanked version forcing a split, or
 * a local-path core alongside a JSR-resolved one — the last is why identity
 * is compared, not version strings, which can match across two copies).
 *
 * Returns a warning message, or null when unified or when the plugin predates
 * the handshake (no `resolvedCoreSentinel` export).
 */
export function adminCoreMismatch(adminModule: Record<string, unknown>): string | null {
  if (!("resolvedCoreSentinel" in adminModule)) return null;
  if (adminModule.resolvedCoreSentinel === CORE_INSTANCE) return null;
  const theirs = typeof adminModule.resolvedCoreVersion === "string"
    ? adminModule.resolvedCoreVersion
    : "pre-0.31 (or unknown)";
  const hint = theirs === CORE_VERSION
    ? "Same version loaded twice — the site likely runs @dune/core from a local path while the plugin resolved it from JSR."
    : "Check the plugin's @dune/core version range — it must include the site's core version so Deno can unify them.";
  return `[dune] @dune/plugin-admin resolved its own copy of @dune/core@${theirs} ` +
    `instead of sharing this process's @dune/core@${CORE_VERSION} — two core instances ` +
    `are now loaded, and admin routes will not see the site's registries or singletons. ${hint}`;
}
