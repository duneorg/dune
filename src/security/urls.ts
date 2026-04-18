/**
 * URL scheme validation for user-authored href/src attributes.
 *
 * Prevents `javascript:`, `vbscript:`, and most `data:` URLs from being
 * rendered into HTML as clickable links or loadable resources.
 *
 * Uses a scheme allowlist; anything else (including relative paths,
 * fragment-only, and protocol-relative URLs) is returned unchanged when safe,
 * or replaced with a fallback when not.
 */

const SAFE_SCHEMES: readonly string[] = [
  "http:",
  "https:",
  "mailto:",
  "tel:",
];

// Matches a leading scheme ("scheme:") that a browser would resolve as a URL
// protocol. Accepts standard scheme syntax per RFC 3986.
const SCHEME_RE = /^([a-z][a-z0-9+.-]*):/i;

/**
 * Return true if the URL is safe to render as an href/src.
 *
 * Safe forms:
 *   - Empty string or "#anchor"
 *   - Relative paths: "/foo", "./foo", "../foo", "foo/bar"
 *   - Protocol-relative (treated as http/https): "//example.com/foo"
 *   - http:, https:, mailto:, tel: URLs
 *
 * Rejects: javascript:, vbscript:, data:, file:, and any unknown scheme.
 * Leading whitespace and control chars (used for browser-parser bypass) are
 * rejected outright — stricter than browsers so obfuscation attempts fail.
 */
export function isSafeUrl(url: string | null | undefined): boolean {
  if (url == null) return false;
  const raw = String(url);
  if (raw === "") return true;

  // Reject any control chars (including tab/newline) — obfuscation vector:
  // "java\tscript:alert(1)" is parsed as javascript: by some browsers.
  if (/[\x00-\x1f\x7f]/.test(raw)) return false;

  const trimmed = raw.trimStart();
  if (trimmed !== raw) return false;

  // Fragment-only and path-relative are always safe.
  if (trimmed.startsWith("#") || trimmed.startsWith("/") || trimmed.startsWith("./") || trimmed.startsWith("../")) {
    return true;
  }

  const m = trimmed.match(SCHEME_RE);
  if (!m) {
    // No scheme → treated as relative path.
    return true;
  }

  const scheme = m[1].toLowerCase() + ":";
  return SAFE_SCHEMES.includes(scheme);
}

/**
 * Return the URL if safe, otherwise `fallback` (default "#").
 * Convenience wrapper for template rendering.
 */
export function safeUrl(url: string | null | undefined, fallback = "#"): string {
  return isSafeUrl(url) ? String(url ?? "") : fallback;
}
