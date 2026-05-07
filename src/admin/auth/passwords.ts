/**
 * Password hashing using PBKDF2 with SHA-256.
 *
 * Format: `pbkdf2:iterations:salt:hash` where salt and hash are hex-encoded.
 *
 * Modern best practice is Argon2id with `m=64MiB, t=3, p=1`. Migrating to
 * Argon2id is a multi-step change (new dependency, schema versioning, opaque
 * blob format); it's tracked separately. As an intermediate hardening this
 * commit raises the PBKDF2 iteration count to OWASP-2024's minimum of
 * 600 000 for SHA-256 and adds a `needsRehash()` helper so a future
 * Argon2id (or higher-iteration) migration can transparently rehash on
 * successful login.
 */

import { encodeHex } from "@std/encoding/hex";

/**
 * Pre-computed PBKDF2 hash used for constant-time dummy comparisons.
 *
 * When a login attempt uses an unknown username, we still run `verifyPassword()`
 * against this hash so the response time is indistinguishable from a valid-user
 * attempt (preventing username enumeration via timing side-channels).
 * The hash will never validate — it is a fixed string in the correct format.
 *
 * Iteration count must equal ITERATIONS so dummy compares pay the same CPU
 * cost as real ones; otherwise the time delta becomes a username oracle.
 */
const ITERATIONS = 600_000; // OWASP 2024 minimum for PBKDF2-SHA256
const MIN_ACCEPTABLE_ITERATIONS = 100_000; // grandfathered legacy hashes
export const DUMMY_HASH =
  `pbkdf2:${ITERATIONS}:00000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000`;

const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const ALGORITHM = "PBKDF2";
const HASH_ALGO = "SHA-256";

/**
 * Hash a plaintext password.
 * Returns a string in the format `pbkdf2:600000:salt:hash`.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const key = await deriveKey(password, salt, ITERATIONS);
  return `pbkdf2:${ITERATIONS}:${encodeHex(salt)}:${encodeHex(key)}`;
}

/**
 * Returns true if the stored hash is below the current cost parameters and
 * should be re-hashed on the next successful login. Callers can wrap their
 * verify-then-rehash flow with this check.
 */
export function needsRehash(stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return true;
  const iter = parseInt(parts[1], 10);
  if (!Number.isFinite(iter)) return true;
  return iter < ITERATIONS;
}

/**
 * Verify a password against a stored hash.
 */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;

  const iterations = parseInt(parts[1], 10);
  // Refuse cost parameters below an absolute floor — protects against a
  // tampered user file that downgrades iterations to make brute force
  // trivial on a leaked hash.
  if (!Number.isFinite(iterations) || iterations < MIN_ACCEPTABLE_ITERATIONS) {
    return false;
  }
  const salt = hexToBytes(parts[2]);
  const expectedBytes = hexToBytes(parts[3]);

  const derivedBytes = await deriveKey(password, salt, iterations);

  // Constant-time byte comparison — avoids the timing side-channel in the
  // previous hex-string comparison which also had an early return on length.
  return timingSafeEqual(expectedBytes, derivedBytes);
}

async function deriveKey(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: ALGORITHM },
    false,
    ["deriveBits"],
  );

  const bits = await crypto.subtle.deriveBits(
    { name: ALGORITHM, salt: salt as BufferSource, iterations, hash: HASH_ALGO },
    passwordKey,
    KEY_LENGTH * 8,
  );

  return new Uint8Array(bits);
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

/**
 * Constant-time comparison of two byte arrays.
 *
 * Runs for max(a.length, b.length) iterations regardless of content,
 * and captures a length difference in the initial XOR — no early returns.
 * Operating on raw bytes (not hex strings) removes the encoding layer.
 */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  const maxLen = Math.max(a.length, b.length);
  // Start with the length difference: if lengths differ, result is already non-zero.
  let result = a.length ^ b.length;
  for (let i = 0; i < maxLen; i++) {
    result |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return result === 0;
}
