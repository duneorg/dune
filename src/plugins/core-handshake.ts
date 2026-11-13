/**
 * Core-instance handshake for dynamically imported plugins.
 *
 * A plugin that depends on `@dune/core` may re-export the `CORE_INSTANCE`
 * sentinel and `CORE_VERSION` it resolved (as `resolvedCoreSentinel` and
 * `resolvedCoreVersion`; `@dune/plugin-admin` does). If that sentinel is not
 * reference-equal to ours, the resolver loaded a second copy of core into this
 * process: module-level singletons are split and the plugin runs different core
 * code than the site. Identity is compared, not version strings, which can
 * match across two copies (a local-path core alongside a JSR-resolved one).
 *
 * @module
 */

import { CORE_INSTANCE, CORE_VERSION } from "./mod.ts";

/**
 * A warning message when `pluginModule` resolved a different core instance, or
 * null when unified or when the plugin predates the handshake (it exports no
 * `resolvedCoreSentinel`).
 */
export function pluginCoreMismatch(
  pluginModule: Record<string, unknown>,
  pluginName: string,
): string | null {
  if (!("resolvedCoreSentinel" in pluginModule)) return null;
  if (pluginModule.resolvedCoreSentinel === CORE_INSTANCE) return null;
  const theirs = typeof pluginModule.resolvedCoreVersion === "string"
    ? pluginModule.resolvedCoreVersion
    : "pre-0.31 (or unknown)";
  const hint = theirs === CORE_VERSION
    ? "Same version loaded twice: the site likely runs @dune/core from a local path while the plugin resolved it from JSR."
    : "Check the plugin's @dune/core version range: it must include the site's core version so Deno can unify them.";
  return `[dune] ${pluginName} resolved its own copy of @dune/core@${theirs} ` +
    `instead of sharing this process's @dune/core@${CORE_VERSION}: two core instances ` +
    `are now loaded, and the plugin will not see the site's registries or singletons. ${hint}`;
}
