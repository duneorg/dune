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

/** The built-in admin plugin package (bootstrap.ts's dynamic import). */
export const ADMIN_PLUGIN_SPECIFIER = "jsr:@dune/plugin-admin@^3.0";

/**
 * The `DunePlugin.name` value `@dune/plugin-admin`'s `createAdminPlugin()`
 * returns (`mod.ts`). `mountPlugins()` (plugins/loader.ts) matches on this
 * to mount the admin plugin's `adminContext`-injecting middleware before any
 * other plugin's routes, regardless of registration order — see that
 * function's doc comment for why registration order alone isn't enough.
 */
export const ADMIN_PLUGIN_NAME = "dune-admin";

/** The admin mount subpath used by the multisite manager. */
export const ADMIN_MOUNT_SPECIFIER = "jsr:@dune/plugin-admin@^3.0/admin/mount";

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
