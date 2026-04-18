/**
 * Minimal password strength check.
 *
 * Enforces length and rejects a small blocklist of top passwords (including
 * local patterns like "dune", "admin"). This is intentionally lightweight —
 * it does not replace a HIBP breach check or zxcvbn, but catches the
 * low-hanging fruit that length-only enforcement misses.
 */

export const MIN_PASSWORD_LENGTH = 12;

// Tiny blocklist of extremely common passwords and local-obvious strings.
// Normalized to lowercase for comparison.
const BLOCKLIST = new Set<string>([
  "password",
  "passwordpassword",
  "passw0rd",
  "password123",
  "password1234",
  "letmein",
  "letmeinplease",
  "welcome",
  "welcome123",
  "welcome1234",
  "qwerty",
  "qwertyuiop",
  "qwerty123456",
  "123456789012",
  "1234567890",
  "1234567890ab",
  "abcdefghijkl",
  "administrator",
  "administrator1",
  "administrator!",
  "admin12345678",
  "adminadmin",
  "adminpassword",
  "dunepassword",
  "duneadmin",
  "dune12345678",
  "changeme1234",
  "changemeplease",
  "iloveyou1234",
  "superuser123",
]);

export type PasswordCheckResult = { ok: true } | { ok: false; reason: string };

/**
 * Validate a candidate password. Returns `{ ok: true }` on success or an
 * error reason suitable for surfacing to an authenticated admin.
 */
export function checkPasswordStrength(password: unknown): PasswordCheckResult {
  if (typeof password !== "string") {
    return { ok: false, reason: "password is required" };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, reason: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` };
  }
  const normalized = password.toLowerCase();
  if (BLOCKLIST.has(normalized)) {
    return { ok: false, reason: "Password is too common — pick something less predictable" };
  }
  // Reject single-character and single-digit runs (e.g. "aaaaaaaaaaaa", "111111111111").
  if (/^(.)\1+$/.test(password)) {
    return { ok: false, reason: "Password must not be a single repeated character" };
  }
  // Reject trivial sequential runs across the full password.
  if (/^0123456789/.test(password) || /^abcdefghijkl/i.test(password)) {
    return { ok: false, reason: "Password must not be a simple sequential pattern" };
  }
  return { ok: true };
}
