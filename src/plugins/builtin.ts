/**
 * Registry specifiers for the built-in admin plugin.
 *
 * These are imported at runtime via *variable-argument* dynamic `import()`
 * (bootstrap.ts, multisite/manager.ts) to break the circular publish-time
 * dependency between @dune/core and @dune/plugin-admin — which means Deno's
 * module-graph builder cannot follow them statically, so `deno cache
 * <core>/cli` never records them and `dune lockfile sync` would produce a
 * lockfile that a `--frozen` serve rejects the moment bootstrap loads the
 * admin plugin. The lockfile discovery helper therefore reports these
 * specifiers explicitly for admin-enabled sites.
 *
 * Keep every variable-imported external specifier defined HERE and consumed
 * from here by both the runtime import site and lockfile-resolve-helper.ts —
 * an inline string at the import site silently reopens the lockfile gap.
 */

/** The built-in admin plugin package (bootstrap.ts's dynamic import). */
export const ADMIN_PLUGIN_SPECIFIER = "jsr:@dune/plugin-admin@^1.0";

/** The admin mount subpath used by the multisite manager. */
export const ADMIN_MOUNT_SPECIFIER = "jsr:@dune/plugin-admin@^1.0/admin/mount";
