/**
 * Password hashing using PBKDF2 with SHA-256.
 *
 * Format: `pbkdf2:iterations:salt:hash` where salt and hash are hex-encoded.
 */

import { encodeHex } from "@std/encoding/hex";

const ITERATIONS = 100_000;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const ALGORITHM = "PBKDF2";
const HASH_ALGO = "SHA-256";

/**
 * Hash a plaintext password.
 * Returns a string in the format `pbkdf2:100000:salt:hash`.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const key = await deriveKey(password, salt, ITERATIONS);
  return `pbkdf2:${ITERATIONS}:${encodeHex(salt)}:${encodeHex(key)}`;
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
