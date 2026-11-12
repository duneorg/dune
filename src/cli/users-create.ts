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
 * commands do, and syncs the app:site authz tuple the same way when an
 * admin-tier role (admin/editor/author) is included, so a pre-granted
 * admin-tier role is effective at once — not just present in roles[] but
 * inert until the user's first login re-syncs it. A running `dune serve` picks
 * the new tuples up on its next permission check (the local authz adapter
 * rescans data/permissions/ about once a second); no restart is needed.
 *
 * With --password-prompt (or --stdin / --generate) it instead creates a
 * *local-password* account (`provider: "local"`, `--username`, default the
 * email's local part) — the explicit first-admin bootstrap:
 *   dune users:create admin@example.com --role admin --username admin --password-prompt
 * The password is never an argument; see password-input.ts.
 *
 * Usage:
 *   dune users:create alice@example.com
 *   dune users:create alice@example.com --role editor
 *   dune users:create alice@example.com --role beta-tester,editor --name "Alice"
 */

import { resolveDataDir } from "../forms/config.ts";
import { resolve } from "@std/path";
import { loadConfig } from "../config/mod.ts";
import { createStorage } from "../storage/mod.ts";
import {
  createLocalUserStore,
  DuplicateEmailError,
} from "../auth/user-store.ts";
import type { UserStore } from "../auth/user-store.ts";
import { createDbUserStore } from "../auth/user-store-db.ts";
import { createDuneAuthSystem } from "../auth/authz.ts";
import { SITE_RESOURCE } from "../auth/authz-schema.ts";
import { syncUserRoles } from "../auth/sync-roles.ts";
import { loadHmacKeyFromEnv } from "../auth/authz-hmac.ts";
import { createDbAdapter } from "../db/adapters/mod.ts";
import type { DbAdapter } from "../db/types.ts";
import { acquirePassword, PasswordInputError } from "./password-input.ts";
import type { PasswordInputOptions } from "./password-input.ts";
import { hashPassword } from "../auth/passwords.ts";
import { checkPasswordStrength } from "../security/password-strength.ts";

const ADMIN_TIER_ROLES = new Set(["admin", "editor", "author"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface UsersCreateOptions extends PasswordInputOptions {
  roles?: string[];
  name?: string;
  dryRun?: boolean;
  /**
   * Create a local-password account instead of an invited one: the password
   * is prompted for (or --stdin / --generate). Implied by --stdin/--generate.
   */
  passwordPrompt?: boolean;
  /** Login name for a local-password account. */
  username?: string;
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
  const dataDir = resolveDataDir(config);
  const siteAuth = (config.site as { auth?: { user_store?: string } }).auth;
  const userStoreTier = siteAuth?.user_store ?? "local";

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

/** Grant the app:site authz tuple for an admin-tier role, if one was requested. */
async function syncAdminTuple(
  ctx: Context,
  userId: string,
  role: string | undefined,
  roles: string[],
): Promise<void> {
  if (roles.length === 0) return;
  const hmacKey = await loadHmacKeyFromEnv().catch((err) => {
    console.error("  ⚠️  Invalid DUNE_AUTHZ_HMAC_SECRET:", err.message);
    return null;
  });
  const { authz, adapter } = createDuneAuthSystem({
    authzStore: "local",
    dataDir: ctx.dataDir,
    hmacKey,
  }, ctx.storage);

  await syncUserRoles({ authz, adapter }, { id: userId, roles });
  if (!role) return;
  await authz.allow({
    who: { type: "user", id: userId },
    toBe: role as "admin" | "editor" | "author",
    onWhat: SITE_RESOURCE,
  });
}

export async function usersCreateCommand(
  root: string,
  email: string,
  opts: UsersCreateOptions = {},
): Promise<void> {
  root = resolve(root);
  const { roles = [], name, dryRun = false } = opts;
  const withPassword = opts.passwordPrompt === true || opts.stdin === true ||
    opts.generate === true || opts.readPassword !== undefined;

  if (!email) {
    console.error(
      `  ✗ Usage: dune users:create <email> [--role x[,y]] [--name "Display Name"]`,
    );
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
      console.error(
        `  ✗ A user with email "${normalizedEmail}" already exists.`,
      );
      Deno.exit(1);
    }

    const adminTierRole = roles.find((r) => ADMIN_TIER_ROLES.has(r));

    // Local-password account (first-admin bootstrap, scripted provisioning):
    // validate everything before writing so a bad password or taken username
    // never leaves a half-created account behind.
    const username = (opts.username ?? normalizedEmail.split("@")[0]).trim();
    let password: string | undefined;
    let generated = false;
    if (withPassword) {
      if (await ctx.userStore.getByUsername(username)) {
        console.error(
          `  ✗ Username "${username}" is already taken — pick another with --username.`,
        );
        Deno.exit(1);
      }
      if (!dryRun) {
        try {
          ({ password, generated } = await acquirePassword(opts));
        } catch (err) {
          if (err instanceof PasswordInputError) {
            console.error(`  ✗ ${err.message}`);
            Deno.exit(1);
          }
          throw err;
        }
        const strength = checkPasswordStrength(password);
        if (!strength.ok) {
          console.error(`  ✗ ${strength.reason}`);
          Deno.exit(1);
        }
      }
    }

    if (dryRun) {
      console.log(
        `  ~ Would create user ${normalizedEmail} (roles: ${
          JSON.stringify(roles)
        }, provider: "${withPassword ? "local" : "invited"}"${
          withPassword ? `, username: "${username}"` : ""
        })`,
      );
      if (adminTierRole) {
        console.log(`  ~ Would sync app:site tuple (none → ${adminTierRole})`);
      }
      return;
    }

    let user;
    try {
      user = await ctx.userStore.create({
        email: normalizedEmail,
        name,
        ...(password !== undefined
          ? {
            provider: "local",
            username,
            passwordHash: await hashPassword(password),
          }
          : { provider: "invited" }),
        roles,
      });
    } catch (err) {
      if (err instanceof DuplicateEmailError) {
        console.error(
          `  ✗ A user with email "${normalizedEmail}" already exists.`,
        );
        Deno.exit(1);
      }
      throw err;
    }

    await syncAdminTuple(ctx, user.id, adminTierRole, user.roles);

    console.log(
      `  ✓ Created ${normalizedEmail}${
        roles.length ? ` (roles: ${roles.join(", ")})` : ""
      }`,
    );
    if (password !== undefined) {
      console.log(`  ✓ Local password set; they can sign in as "${username}".`);
      if (generated) {
        console.log(
          `\n  Generated password (shown once — store it now):\n\n    ${password}\n`,
        );
      }
      return;
    }
    console.log(
      `  ℹ️  They can now log in via magic link and land in this account. ` +
        `A first login via OAuth will be rejected (no linked provider yet) — ` +
        `see this command's own doc comment for why.`,
    );
  } finally {
    await ctx.closeDb();
  }
}
