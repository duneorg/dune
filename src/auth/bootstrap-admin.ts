/**
 * First-admin bootstrap from the environment.
 *
 * Dune never creates a default admin. The first admin is an explicit act:
 * either `dune users:create <email> --role admin --password-prompt`, or —
 * for container/server deployments — `DUNE_ADMIN_EMAIL` +
 * `DUNE_ADMIN_PASSWORD` (+ optional `DUNE_ADMIN_USERNAME`, default "admin")
 * read once at boot.
 *
 * Rules:
 *   - Applies only when no enabled admin exists. It never overrides or
 *     resets an existing account (that is `dune users:passwd`).
 *   - Both email and password must be set, or neither.
 *   - A weak password fails boot with a clear error. The password is never
 *     logged.
 *   - Lives in core so it works with any admin implementation, or none.
 *
 * @module
 */

import { hashPassword } from "./passwords.ts";
import { checkPasswordStrength } from "../security/password-strength.ts";
import type { UserStore } from "./user-store.ts";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface EnvAdminBootstrapResult {
  created: boolean;
  /** Why nothing was created. */
  reason?: "not-configured" | "admin-exists";
  userId?: string;
  username?: string;
}

export interface EnvAdminBootstrapOptions {
  userStore: UserStore;
  /** Environment lookup; defaults to `Deno.env`. */
  env?: { get(key: string): string | undefined };
  /** Called with the new admin's id, e.g. to register the app:admin authz tuple. */
  onCreated?: (user: { id: string; role: "admin" }) => Promise<void>;
}

/** @throws {Error} on a half-configured, malformed or weak env credential, or a taken username/email. */
export async function ensureAdminFromEnv(
  opts: EnvAdminBootstrapOptions,
): Promise<EnvAdminBootstrapResult> {
  const env = opts.env ?? Deno.env;
  const email = env.get("DUNE_ADMIN_EMAIL")?.trim().toLowerCase();
  const password = env.get("DUNE_ADMIN_PASSWORD");
  if (!email && !password) return { created: false, reason: "not-configured" };
  if (!email || !password) {
    throw new Error(
      "DUNE_ADMIN_EMAIL and DUNE_ADMIN_PASSWORD must be set together (or neither).",
    );
  }

  const existing = await opts.userStore.list();
  if (existing.some((u) => u.enabled !== false && u.roles.includes("admin"))) {
    return { created: false, reason: "admin-exists" };
  }

  if (!EMAIL_RE.test(email)) {
    throw new Error(
      `DUNE_ADMIN_EMAIL is not a valid email address: "${email}"`,
    );
  }
  const strength = checkPasswordStrength(password);
  if (!strength.ok) {
    throw new Error(`DUNE_ADMIN_PASSWORD rejected: ${strength.reason}`);
  }
  const username = env.get("DUNE_ADMIN_USERNAME")?.trim() || "admin";
  if (await opts.userStore.getByEmail(email)) {
    throw new Error(
      `DUNE_ADMIN_EMAIL ${email} belongs to an existing non-admin account; ` +
        `grant it the role with \`dune users:grant-role ${email} admin\` instead.`,
    );
  }
  if (await opts.userStore.getByUsername(username)) {
    throw new Error(
      `Username "${username}" is already taken; set DUNE_ADMIN_USERNAME to another.`,
    );
  }

  const user = await opts.userStore.create({
    email,
    username,
    name: "Admin",
    provider: "local",
    roles: ["admin"],
    passwordHash: await hashPassword(password),
  });
  await opts.onCreated?.({ id: user.id, role: "admin" });
  return { created: true, userId: user.id, username };
}
