/**
 * Plugin specifier validation — supply-chain pinning check.
 *
 * Mirrors `src/themes/reference.ts`'s pinned-specifier rule: a plugin loaded
 * from a registry executes with full process privileges at startup, so a
 * `jsr:`/`npm:` plugin specifier must pin an exact version rather than a
 * caret/tilde range or a bare name that could resolve to a newer,
 * unreviewed (or typosquatted) release.
 */

/** Remote package specifiers must pin an exact semver (supply-chain safety). */
export const PINNED_PLUGIN_SPECIFIER_RE =
  /^jsr:@?[a-z0-9_.-]+\/[a-zA-Z0-9_.-]+@\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9_.-]+)?(?:\/.*)?$|^npm:(?:@[^/]+\/)?[^@\s]+@\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9_.-]+)?(?:\/.*)?$/;

/** True when the string is a JSR or npm package specifier. */
export function isRemotePluginSpecifier(spec: string): boolean {
  return spec.startsWith("jsr:") || spec.startsWith("npm:");
}

/**
 * Validate a plugin `src` specifier. No-op for local paths — `jsr:`/`npm:`
 * specifiers require an exact version. `https:` URLs are handled by
 * {@link assertHttpsPluginIntegrity}.
 */
export function assertPinnedPluginSpecifier(spec: string): void {
  if (!isRemotePluginSpecifier(spec)) return;
  if (!PINNED_PLUGIN_SPECIFIER_RE.test(spec)) {
    throw new Error(
      `Plugin package specifier must be pinned to an exact version ` +
        `(e.g. jsr:@dune/plugin-seo@1.0.0), got: ${spec}`,
    );
  }
}

const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

/** Parsed plugin integrity pin (SHA-256 of the module bytes). */
export interface PluginIntegrity {
  hex: string;
}

/**
 * Parse `sha256:<64 hex>` or SRI `sha256-<base64>` into a lowercase hex digest.
 */
export function parsePluginIntegrity(raw: string): PluginIntegrity {
  const trimmed = raw.trim();
  if (trimmed.startsWith("sha256:")) {
    const hex = trimmed.slice("sha256:".length).toLowerCase();
    if (!SHA256_HEX_RE.test(hex)) {
      throw new Error(
        `Plugin integrity sha256: value must be 64 hex characters, got: ${raw}`,
      );
    }
    return { hex };
  }
  if (trimmed.startsWith("sha256-")) {
    const b64 = trimmed.slice("sha256-".length);
    try {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      if (bytes.byteLength !== 32) {
        throw new Error("wrong length");
      }
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"))
        .join("");
      return { hex };
    } catch {
      throw new Error(
        `Plugin integrity SRI value must be sha256-<base64 of 32 bytes>, got: ${raw}`,
      );
    }
  }
  throw new Error(
    `Plugin integrity must be sha256:<64 hex> or SRI sha256-<base64>, got: ${raw}`,
  );
}

/**
 * `https:` plugin sources execute with full process privileges. Require a
 * SHA-256 integrity pin so a swapped origin cannot run unreviewed code.
 */
export function assertHttpsPluginIntegrity(
  src: string,
  integrity: string | undefined,
): void {
  if (!src.startsWith("https:")) return;
  if (!integrity) {
    throw new Error(
      `https: plugin specifier requires an integrity hash ` +
        `(e.g. integrity: sha256:<64 hex chars>), got: ${src}`,
    );
  }
  parsePluginIntegrity(integrity);
}

/** SHA-256 hex digest of `bytes`. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice());
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
}

/** True when `actualHex` matches the integrity pin (constant-time). */
export function integrityMatches(expectedHex: string, actualHex: string): boolean {
  if (expectedHex.length !== actualHex.length) return false;
  let diff = 0;
  for (let i = 0; i < expectedHex.length; i++) {
    diff |= expectedHex.charCodeAt(i) ^ actualHex.charCodeAt(i);
  }
  return diff === 0;
}
