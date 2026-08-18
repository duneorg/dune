/**
 * dune users:grant-role <email> <role>
 * dune users:revoke-role <email> <role>
 *
 * Grant or revoke an admin-tier role ("admin" | "editor" | "author") on an
 * existing unified User, identified by email — the CLI leg of
 * dec-identity-unification Phase 6's role-granting mechanism. The admin
 * panel's `PUT /admin/api/users/:id` route already does this over HTTP; these
 * commands do the same two things it does — update the user's `roles[]` and
 * sync the `app:admin` authz tuple `authz.check()` actually reads — for
 * operators without (or before) web access: first-admin bootstrap on a
 * headless install, scripted/CI-driven site provisioning, or granting access
 * to an existing OAuth/magic-link account that has never had an admin-tier
 * role.
 *
 * Role is treated as a plain string, validated against a small local literal
 * set here — matching how `bootstrapAdminTuples()` (auth/authz.ts) already
 * treats it. The three-string admin-tier role convention is a
 * @dune/plugin-admin concept, not a @dune/core one (dec-identity-unification
 * Phase 5a deliberately collapsed the unified User type down to a plain
 * `roles: string[]` with no closed Role union) — core intentionally doesn't
 * import from plugin-admin (wrong dependency direction), so this small
 * three-string list is duplicated here rather than shared.
 *
 * Idempotent — granting a role the user already has, or revoking one they
 * don't have, is a no-op.
 *
 * Usage:
 *   dune users:grant-role alice@example.com editor
 *   dune users:revoke-role alice@example.com editor
 *   dune users:grant-role alice@example.com editor --dry-run
 */

import { resolve } from "@std/path";
import { loadConfig } from "../config/mod.ts";
import { createStorage } from "../storage/mod.ts";
import { createLocalUserStore } from "../auth/user-store.ts";
import type { UserStore } from "../auth/user-store.ts";
import { createDbUserStore } from "../auth/user-store-db.ts";
import { createDuneAuthSystem } from "../auth/authz.ts";
import { loadHmacKeyFromEnv } from "../auth/authz-hmac.ts";
import { createDbAdapter } from "../db/adapters/mod.ts";
import type { DbAdapter } from "../db/types.ts";

const ADMIN_TIER_ROLES = new Set(["admin", "editor", "author"]);

export interface UsersRoleOptions {
  dryRun?: boolean;
}

interface Context {
  storage: ReturnType<typeof createStorage>;
  dataDir: string;
  userStore: UserStore;
  closeDb: () => Promise<void>;
}

async function openContext(root: string): Promise<Context> {
  const storage = createStorage({ rootDir: root });
  const config = await loadConfig({
    storage,
    rootDir: root,
    skipConfigTs: true,
  });
  // Relative to `storage`'s own rootDir, not joined with `root` — StorageAdapter
  // requires relative paths (see the doc comment on syncAdminTuple below).
  const dataDir = config.admin?.dataDir ?? "data";
  const siteAuth = (config.site as { auth?: { userStore?: string } }).auth;
  const userStoreTier = siteAuth?.userStore ?? "local";

  if (userStoreTier === "db") {
    const dbAdapter: DbAdapter = await createDbAdapter();
    const userStore = await createDbUserStore({ adapter: dbAdapter });
    return { storage, dataDir, userStore, closeDb: () => dbAdapter.close() };
  }

  const userStore = createLocalUserStore({
    storage,
    usersDir: `${dataDir}/users`,
  });
  return { storage, dataDir, userStore, closeDb: () => Promise.resolve() };
}

/** Sync the app:admin authz tuple to match `newRole` (undefined = no admin-tier role). */
async function syncAdminTuple(
  ctx: Context,
  userId: string,
  previousRole: string | undefined,
  newRole: string | undefined,
): Promise<void> {
  const hmacKey = await loadHmacKeyFromEnv().catch((err) => {
    console.error("  ⚠️  Invalid DUNE_AUTHZ_HMAC_SECRET:", err.message);
    return null;
  });
  const { authz } = createDuneAuthSystem({
    authzStore: "local",
    dataDir: ctx.dataDir,
    hmacKey,
  }, ctx.storage);

  if (previousRole && previousRole !== newRole) {
    await authz.disallowAllMatching({
      who: { type: "user", id: userId },
      was: previousRole as "admin" | "editor" | "author",
      onWhat: { type: "app", id: "admin" },
    }).catch((err) => {
      console.warn(`  ⚠️  Failed to revoke old "${previousRole}" tuple:`, err);
    });
  }
  if (newRole && newRole !== previousRole) {
    await authz.allow({
      who: { type: "user", id: userId },
      toBe: newRole as "admin" | "editor" | "author",
      onWhat: { type: "app", id: "admin" },
    });
  }
}

async function changeRole(
  root: string,
  email: string,
  role: string,
  grant: boolean,
  opts: UsersRoleOptions,
): Promise<void> {
  root = resolve(root);
  const { dryRun = false } = opts;
  const label = grant ? "grant-role" : "revoke-role";

  if (!email || !role) {
    console.error(`  ✗ Usage: dune users:${label} <email> <role>`);
    Deno.exit(1);
  }
  if (!ADMIN_TIER_ROLES.has(role)) {
    console.error(
      `  ✗ Invalid role "${role}" — must be one of: admin, editor, author`,
    );
    Deno.exit(1);
  }

  console.log(`🏜️  Dune — users:${label}${dryRun ? " (dry run)" : ""}\n`);

  const ctx = await openContext(root);
  try {
    const user = await ctx.userStore.getByEmail(email);
    if (!user) {
      console.error(`  ✗ No user found with email "${email}"`);
      Deno.exit(1);
    }

    const hasRole = user.roles.includes(role);
    if (grant && hasRole) {
      console.log(`  ℹ️  ${email} already has role "${role}" — nothing to do.`);
      return;
    }
    if (!grant && !hasRole) {
      console.log(
        `  ℹ️  ${email} does not have role "${role}" — nothing to do.`,
      );
      return;
    }

    // Admin-tier roles are mutually exclusive on this axis — granting one
    // replaces any other admin-tier role, matching withRole()'s semantics
    // in @dune/plugin-admin. Non-admin-tier tags (e.g. a future public-site
    // membership tag coexisting on the same account) are preserved.
    const previousRole = [...ADMIN_TIER_ROLES].find((r) =>
      user.roles.includes(r)
    );
    const nonAdminTierTags = user.roles.filter((r) => !ADMIN_TIER_ROLES.has(r));
    const newRoles = grant ? [role, ...nonAdminTierTags] : nonAdminTierTags;
    const newRole = grant ? role : undefined;

    if (dryRun) {
      console.log(
        `  ~ ${email}: roles ${JSON.stringify(user.roles)} → ${
          JSON.stringify(newRoles)
        } — would update`,
      );
      console.log(
        `  ~ ${email}: would sync app:admin tuple (${
          previousRole ?? "none"
        } → ${newRole ?? "none"})`,
      );
      return;
    }

    await ctx.userStore.update(user.id, { roles: newRoles });
    await syncAdminTuple(ctx, user.id, previousRole, newRole);

    console.log(
      grant
        ? `  ✓ ${email}: granted role "${role}"`
        : `  ✓ ${email}: revoked role "${role}"`,
    );
  } finally {
    await ctx.closeDb();
  }
}

export async function grantRoleCommand(
  root: string,
  email: string,
  role: string,
  opts: UsersRoleOptions = {},
): Promise<void> {
  await changeRole(root, email, role, true, opts);
}

export async function revokeRoleCommand(
  root: string,
  email: string,
  role: string,
  opts: UsersRoleOptions = {},
): Promise<void> {
  await changeRole(root, email, role, false, opts);
}
