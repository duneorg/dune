/**
 * Local-account password primitives: hashing, verification and the
 * change-password path shared by the CLI (`dune users:passwd`) and any admin
 * implementation.
 *
 * Format: `pbkdf2:<iterations>:<salt hex>:<key hex>` (PBKDF2-SHA256, 16-byte
 * salt, 32-byte key). Identical to the format @dune/plugin-admin has always
 * written, so existing `passwordHash` values keep verifying.
 *
 * @module
 */

import { decodeHex, encodeHex } from "@std/encoding/hex";
import { checkPasswordStrength } from "../security/password-strength.ts";
import { timingSafeEqualStrings } from "../security/timing-safe.ts";
import type { UserStore } from "./user-store.ts";
import type { User } from "./types.ts";

const ITERATIONS = 600_000; // OWASP 2024 minimum for PBKDF2-SHA256
/** Hashes below this cost are refused outright (tampered/downgraded user file). */
const MIN_ACCEPTABLE_ITERATIONS = 100_000;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

async function deriveKey(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    passwordKey,
    KEY_LENGTH * 8,
  );
  return new Uint8Array(bits);
}

/**
 * A well-formed hash that never verifies. Login paths run `verifyPassword()`
 * against it when the username is unknown, so a miss costs the same CPU as a
 * hit and response time can't be used to enumerate accounts. Its iteration
 * count must equal the current cost for that to hold.
 */
export const DUMMY_HASH =
  `pbkdf2:${ITERATIONS}:00000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000`;

/** Hash a plaintext password. Returns `pbkdf2:600000:<salt>:<key>`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const key = await deriveKey(password, salt, ITERATIONS);
  return `pbkdf2:${ITERATIONS}:${encodeHex(salt)}:${encodeHex(key)}`;
}

/** True if the stored hash is below the current cost and should be re-hashed on next login. */
export function needsRehash(stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return true;
  const iterations = parseInt(parts[1], 10);
  return !Number.isFinite(iterations) || iterations < ITERATIONS;
}

/** Verify a password against a stored hash. Never throws on malformed input. */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = parseInt(parts[1], 10);
  if (!Number.isFinite(iterations) || iterations < MIN_ACCEPTABLE_ITERATIONS) {
    return false;
  }
  let salt: Uint8Array;
  try {
    salt = decodeHex(parts[2]);
  } catch {
    return false;
  }
  const derived = encodeHex(await deriveKey(password, salt, iterations));
  return timingSafeEqualStrings(derived, parts[3]);
}

/** Thrown by {@link changePassword} when the new password fails the strength check. */
export class WeakPasswordError extends Error {
  override name = "WeakPasswordError";
  readonly code = "weak_password";
}

/**
 * Set a new password for a user: strength check, hash, write through the
 * store. Returns the updated user, or null if the id is unknown.
 *
 * Callers that should also log the user out everywhere (a reset after a
 * lockout or suspected compromise) revoke sessions themselves — the store
 * layer doesn't know about sessions.
 *
 * @throws {WeakPasswordError} if the password fails `checkPasswordStrength`.
 */
export async function changePassword(
  store: UserStore,
  userId: string,
  newPassword: string,
): Promise<User | null> {
  const strength = checkPasswordStrength(newPassword);
  if (!strength.ok) throw new WeakPasswordError(strength.reason);
  return await store.update(userId, {
    passwordHash: await hashPassword(newPassword),
  });
}
