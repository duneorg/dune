/**
 * dune users:create <email> [--role x[,y]] [--name "Display Name"]
 *
 * Admin-provisioned local user account — creates a User record directly,
 * before the person has ever logged in. The invited person's *first real
 * login* is what actually claims the account:
 *
 *   - Magic link: matches by email unconditionally (`magicVerify()` in
 *     src/auth/routes.ts), so this just works — no further action needed.
 *   - OAuth: only auto-links when found by (provider, providerId). A record
 *     found only by email (this command's case) is deliberately rejected
 *     with a 409 "please log in with your original method" — the same
 *     anti-account-takeover guard that protects a real existing account
 *     from being silently claimed by a different auth method. There is no
 *     "original method" for a record this command creates, so an invited
 *     user whose *first* login is via OAuth will hit that 409. Point them
 *     at magic link instead, or grant/adjust manually afterward — closed/
 *     invite-only signup (which would need to change the OAuth callback's
 *     linking rules) is a separate, larger feature, deliberately out of
 *     scope here.
 *
 * `provider: "invited"` marks the record as not-yet-claimed by any real
 * auth method, distinct from "local" (password admin accounts), "magic",
 * or an OAuth provider name.
 *
 * Reuses the same UserStore primitive users-role.ts's grant/revoke-role
 * commands do, and syncs the app:admin authz tuple the same way when an
 * admin-tier role (admin/editor/author) is included, so a pre-granted
 * admin-tier role is immediately effective — not just present in roles[]
 * but inert until the user's first login re-syncs it.
 *
 * Usage:
 *   dune users:create alice@example.com
 *   dune users:create alice@example.com --role editor
 *   dune users:create alice@example.com --role beta-tester,editor --name "Alice"
 */

import { resolve } from "@std/path";
import { loadConfig } from "../config/mod.ts";
import { createStorage } from "../storage/mod.ts";
import { createLocalUserStore, DuplicateEmailError } from "../auth/user-store.ts";
import type { UserStore } from "../auth/user-store.ts";
import { createDbUserStore } from "../auth/user-store-db.ts";
import { createDuneAuthSystem } from "../auth/authz.ts";
import { loadHmacKeyFromEnv } from "../auth/authz-hmac.ts";
import { createDbAdapter } from "../db/adapters/mod.ts";
import type { DbAdapter } from "../db/types.ts";

const ADMIN_TIER_ROLES = new Set(["admin", "editor", "author"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface UsersCreateOptions {
  roles?: string[];
  name?: string;
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

/** Grant the app:admin authz tuple for an admin-tier role, if one was requested. */
async function syncAdminTuple(
  ctx: Context,
  userId: string,
  role: string | undefined,
): Promise<void> {
  if (!role) return;
  const hmacKey = await loadHmacKeyFromEnv().catch((err) => {
    console.error("  ⚠️  Invalid DUNE_AUTHZ_HMAC_SECRET:", err.message);
    return null;
  });
  const { authz } = createDuneAuthSystem({
    authzStore: "local",
    dataDir: ctx.dataDir,
    hmacKey,
  }, ctx.storage);

  await authz.allow({
    who: { type: "user", id: userId },
    toBe: role as "admin" | "editor" | "author",
    onWhat: { type: "app", id: "admin" },
  });
}

export async function usersCreateCommand(
  root: string,
  email: string,
  opts: UsersCreateOptions = {},
): Promise<void> {
  root = resolve(root);
  const { roles = [], name, dryRun = false } = opts;

  if (!email) {
    console.error(`  ✗ Usage: dune users:create <email> [--role x[,y]] [--name "Display Name"]`);
    Deno.exit(1);
  }
  const normalizedEmail = email.trim().toLowerCase();
  if (!EMAIL_RE.test(normalizedEmail)) {
    console.error(`  ✗ Invalid email address: "${email}"`);
    Deno.exit(1);
  }

  console.log(`🏜️  Dune — users:create${dryRun ? " (dry run)" : ""}\n`);

  const ctx = await openContext(root);
  try {
    const existing = await ctx.userStore.getByEmail(normalizedEmail);
    if (existing) {
      console.error(`  ✗ A user with email "${normalizedEmail}" already exists.`);
      Deno.exit(1);
    }

    const adminTierRole = roles.find((r) => ADMIN_TIER_ROLES.has(r));

    if (dryRun) {
      console.log(
        `  ~ Would create user ${normalizedEmail} (roles: ${
          JSON.stringify(roles)
        }, provider: "invited")`,
      );
      if (adminTierRole) {
        console.log(`  ~ Would sync app:admin tuple (none → ${adminTierRole})`);
      }
      return;
    }

    let user;
    try {
      user = await ctx.userStore.create({
        email: normalizedEmail,
        name,
        provider: "invited",
        roles,
      });
    } catch (err) {
      if (err instanceof DuplicateEmailError) {
        console.error(`  ✗ A user with email "${normalizedEmail}" already exists.`);
        Deno.exit(1);
      }
      throw err;
    }

    await syncAdminTuple(ctx, user.id, adminTierRole);

    console.log(`  ✓ Created ${normalizedEmail}${roles.length ? ` (roles: ${roles.join(", ")})` : ""}`);
    console.log(
      `  ℹ️  They can now log in via magic link and land in this account. ` +
        `A first login via OAuth will be rejected (no linked provider yet) — ` +
        `see this command's own doc comment for why.`,
    );
  } finally {
    await ctx.closeDb();
  }
}
