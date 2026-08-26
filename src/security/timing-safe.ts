/**
 * Constant-time comparison primitives for secret material (signature headers,
 * webhook tokens, preview tokens, health tokens).
 *
 * One canonical implementation instead of per-module copies: the length
 * pre-check leaks only the length of the expected value (always known/fixed
 * for HMAC outputs), and the loop runs the same number of iterations
 * regardless of where a mismatch occurs.
 *
 * @module
 */

/**
 * Compare two strings in constant time. Intended for fixed-alphabet values of
 * equal natural length (hex digests, base64url signatures, opaque tokens).
 * Returns false immediately when lengths differ — that difference is not a
 * usable side channel since the attacker chooses their own input length.
 */
export function timingSafeEqualStrings(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
