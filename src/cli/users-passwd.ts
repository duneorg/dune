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
import { encodeBase64Url } from "@std/encoding/base64url";
import { loadConfig } from "../config/mod.ts";
import { createStorage } from "../storage/mod.ts";
import { createLocalUserStore } from "../auth/user-store.ts";
import type { UserStore } from "../auth/user-store.ts";
import { createDbUserStore } from "../auth/user-store-db.ts";
import { changePassword, WeakPasswordError } from "../auth/passwords.ts";
import { createDbAdapter } from "../db/adapters/mod.ts";
import type { DbAdapter } from "../db/types.ts";
import { createSessionManager, createSessionStore } from "../session/mod.ts";
import { promptSecret, readSecretFromStdin } from "./prompt-secret.ts";

export interface UsersPasswdOptions {
  /** Read the password from stdin instead of prompting. */
  stdin?: boolean;
  /** Generate a random password and print it once. */
  generate?: boolean;
  /** Prompt/stdin overrides — tests only. */
  readPassword?: () => Promise<string>;
}

interface Context {
  userStore: UserStore;
  /** Revoke every session (admin + public site) for a user. */
  revokeSessions: (userId: string) => Promise<void>;
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
  const runtimeDir = config.admin?.runtimeDir ?? ".dune/admin";
  const siteAuth = (config.site as { auth?: { userStore?: string } }).auth;

  let userStore: UserStore;
  let closeDb: () => Promise<void> = () => Promise.resolve();
  if ((siteAuth?.userStore ?? "local") === "db") {
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

function generatePassword(): string {
  return encodeBase64Url(crypto.getRandomValues(new Uint8Array(18)));
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

  const ctx = await openContext(root);
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
    if (opts.generate) {
      password = generatePassword();
    } else if (opts.stdin) {
      password = await readSecretFromStdin();
    } else if (opts.readPassword) {
      password = await opts.readPassword();
    } else {
      if (!Deno.stdin.isTerminal()) {
        fail(
          "No terminal to prompt on — use --stdin (password on stdin) or --generate.",
        );
      }
      password = await promptSecret("New password: ");
      const again = await promptSecret("Repeat it:    ");
      if (password !== again) {
        fail("The two entries differ; nothing was changed.");
      }
    }

    try {
      await changePassword(ctx.userStore, user.id, password);
    } catch (err) {
      if (err instanceof WeakPasswordError) fail(err.message);
      throw err;
    }
    await ctx.revokeSessions(user.id);

    const label = user.username ?? user.email;
    console.log(
      `  ✓ Password updated for ${label}; existing sessions revoked.`,
    );
    if (opts.generate) {
      console.log(
        `\n  Generated password (shown once — store it now):\n\n    ${password}\n`,
      );
    }
  } finally {
    await ctx.closeDb();
  }
}
