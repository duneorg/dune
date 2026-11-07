/**
 * dune users:passwd <email-or-username> [--stdin | --generate]
 *
 * Set or reset a local user's password from the command line — admin
 * lockout recovery, rotating a password nobody has the plaintext of, or
 * setting the first admin's password without a plaintext file on disk.
 *
 * The password is never an argument (shell history, `ps`):
 *   - default: prompted on a TTY with no echo, asked twice
 *   - --stdin: read from stdin (scripted use)
 *   - --generate: a random password, printed once to stdout
 *
 * Goes through the same path as the admin UI: core's `checkPasswordStrength`
 * and `hashPassword` via the user store. All of the user's existing
 * sessions (admin and public site) are revoked, so a reset after a lockout
 * or suspected compromise actually logs old sessions out.
 *
 * Only accounts with a local password qualify (`provider: "local"` or an
 * existing `passwordHash`). OAuth, magic-link and invited records are
 * refused — they have no local password to reset.
 *
 * Running the CLI already requires shell access to the site's data
 * directory, so this adds no new trust boundary.
 *
 * Usage:
 *   dune users:passwd admin
 *   dune users:passwd alice@example.com
 *   echo "$NEW" | dune users:passwd alice@example.com --stdin
 *   dune users:passwd alice@example.com --generate
 */

import { resolve } from "@std/path";
import { loadConfig } from "../config/mod.ts";
import { createStorage } from "../storage/mod.ts";
import { resolveFormsConfig } from "../forms/config.ts";
import { createLocalUserStore } from "../auth/user-store.ts";
import type { UserStore } from "../auth/user-store.ts";
import { createDbUserStore } from "../auth/user-store-db.ts";
import { changePassword, WeakPasswordError } from "../auth/passwords.ts";
import { createDbAdapter } from "../db/adapters/mod.ts";
import type { DbAdapter } from "../db/types.ts";
import {
  createSessionManager,
  createSessionStore,
  resolveSessionPrefix,
} from "../session/mod.ts";
import { acquirePassword, PasswordInputError } from "./password-input.ts";
import type { PasswordInputOptions } from "./password-input.ts";
import { resolveRuntimeDir } from "../forms/config.ts";

export interface UsersPasswdOptions extends PasswordInputOptions {
  /**
   * Multisite site id (`--site`). Selects the same Redis/KV session key prefix
   * the running site uses, so revocation reaches its sessions.
   */
  siteId?: string;
}

interface Context {
  userStore: UserStore;
  /** Revoke every session (admin + public site) for a user. */
  revokeSessions: (userId: string) => Promise<void>;
  closeDb: () => Promise<void>;
}

async function openContext(root: string, siteId?: string): Promise<Context> {
  const storage = createStorage({ rootDir: root });
  const config = await loadConfig({
    storage,
    rootDir: root,
    skipConfigTs: true,
  });
  // Same resolution as the admin plugin and core: system.data_dir.
  const dataDir = resolveFormsConfig(config).dataDir;
  const runtimeDir = resolveRuntimeDir(config);
  const siteAuth = (config.site as { auth?: { user_store?: string } }).auth;

  let userStore: UserStore;
  let closeDb: () => Promise<void> = () => Promise.resolve();
  if ((siteAuth?.user_store ?? "local") === "db") {
    const dbAdapter: DbAdapter = await createDbAdapter();
    userStore = await createDbUserStore({ adapter: dbAdapter });
    closeDb = () => dbAdapter.close();
  } else {
    userStore = createLocalUserStore({ storage, usersDir: `${dataDir}/users` });
  }

  // Admin and public-site sessions live in separate namespaces (see
  // auth/mount.ts and plugin-admin's createSessionManager); revoke both.
  const sessionCfg = config.system?.session_store;
  const redisUrl = sessionCfg?.url
    ? (sessionCfg.url.startsWith("$")
      ? Deno.env.get(sessionCfg.url.slice(1))
      : sessionCfg.url)
    : undefined;
  const prefix = resolveSessionPrefix(sessionCfg?.prefix, siteId);
  const lifetimeMs = 24 * 60 * 60 * 1000; // irrelevant for deletion
  const managers = await Promise.all(
    ["sessions", "site-sessions"].map(async (dir) =>
      createSessionManager(
        await createSessionStore({
          type: sessionCfg?.type ?? "local",
          redisUrl,
          storage,
          sessionsDir: `${runtimeDir}/${dir}`,
          lifetimeMs,
          prefix,
        }),
        lifetimeMs,
      )
    ),
  );
  const revokeSessions = async (userId: string) => {
    for (const m of managers) await m.revokeAll(userId);
  };

  return { userStore, revokeSessions, closeDb };
}

function fail(message: string): never {
  console.error(`  ✗ ${message}`);
  Deno.exit(1);
}

export async function usersPasswdCommand(
  root: string,
  identifier: string,
  opts: UsersPasswdOptions = {},
): Promise<void> {
  root = resolve(root);
  if (!identifier) {
    fail("Usage: dune users:passwd <email-or-username> [--stdin | --generate]");
  }
  if (opts.stdin && opts.generate) {
    fail("--stdin and --generate are mutually exclusive");
  }

  console.log(`🏜️  Dune — users:passwd\n`);

  const ctx = await openContext(root, opts.siteId);
  try {
    const needle = identifier.trim();
    const user = needle.includes("@")
      ? await ctx.userStore.getByEmail(needle.toLowerCase())
      : await ctx.userStore.getByUsername(needle);
    if (!user) fail(`No user found for "${identifier}"`);
    if (user.provider !== "local" && !user.passwordHash) {
      fail(
        `"${identifier}" has no local password (provider: ${user.provider}) — ` +
          `nothing to reset. They sign in via ${
            user.provider === "invited" ? "magic link" : user.provider
          }.`,
      );
    }

    let password: string;
    let generated: boolean;
    try {
      ({ password, generated } = await acquirePassword(opts));
    } catch (err) {
      if (err instanceof PasswordInputError) fail(err.message);
      throw err;
    }

    try {
      await changePassword(ctx.userStore, user.id, password);
    } catch (err) {
      if (err instanceof WeakPasswordError) fail(err.message);
      throw err;
    }
    try {
      await ctx.revokeSessions(user.id);
    } catch (err) {
      fail(
        `Password was changed, but revoking existing sessions failed: ${
          err instanceof Error ? err.message : String(err)
        }. Old sessions may still be valid; check the session store.`,
      );
    }

    const label = user.username ?? user.email;
    console.log(
      `  ✓ Password updated for ${label}; existing sessions revoked.`,
    );
    if (generated) {
      console.log(
        `\n  Generated password (shown once — store it now):\n\n    ${password}\n`,
      );
    }
  } finally {
    await ctx.closeDb();
  }
}
