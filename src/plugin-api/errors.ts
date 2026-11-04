/**
 * Stable error identity for plugins.
 *
 * `instanceof` fails across two copies of a module, and a plugin may be
 * resolved against a different copy of core than the one running. Errors that
 * cross the plugin boundary therefore carry a stable `code`; test with
 * {@link isDuneError} instead of `instanceof`.
 *
 * @module
 */

/** Codes of the errors a plugin can receive from core services. */
export type DuneErrorCode =
  | "body_too_large"
  | "ssrf_blocked"
  | "duplicate_email"
  | "weak_password";

/** True if `err` is a Dune error with the given `code`. */
export function isDuneError(err: unknown, code: DuneErrorCode): boolean {
  return typeof err === "object" && err !== null &&
    (err as { code?: unknown }).code === code;
}
