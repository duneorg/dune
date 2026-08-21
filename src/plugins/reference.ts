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
 * Validate a plugin `src` specifier. No-op for local paths and `https:`
 * URLs — only `jsr:`/`npm:` specifiers require pinning.
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
