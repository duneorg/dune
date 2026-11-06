/**
 * Post-login redirect targets.
 *
 * @module
 */

/**
 * Sanitize a `next` redirect target so a login cannot be turned into an open
 * redirect. Only a same-site absolute path is accepted; anything else (an
 * external URL, `//host`, `/\host` which browsers read as `//host`, a
 * `javascript:` URI, control characters, an oversized value) falls back to `/`.
 */
export function sanitizeNext(next: string | null | undefined): string {
  if (!next) return "/";
  const trimmed = next.trim();
  if (trimmed.length === 0 || trimmed.length > 2048) return "/";
  // Must be a path. "//" is scheme-relative; "/\" is read as "//" by browsers.
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.startsWith("/\\")) return "/";
  // No control characters, whitespace or backslashes anywhere (header injection, parser differentials).
  // deno-lint-ignore no-control-regex
  if (/[\u0000-\u001f\u007f\s\\]/.test(trimmed)) return "/";
  // Resolve against a throwaway origin: the result must stay on it.
  try {
    const base = "http://dune.invalid";
    const resolved = new URL(trimmed, base);
    if (resolved.origin !== base) return "/";
    return resolved.pathname + resolved.search + resolved.hash;
  } catch {
    return "/";
  }
}
