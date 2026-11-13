/**
 * A plugin can say which core it needs (`DunePlugin.requiresCore`, normally
 * the `MIN_CORE_VERSION` constant of the `@dune/plugin-api` it was built
 * against). The loader refuses a plugin on an older core with a clear message
 * instead of letting it fail at runtime on a member core does not provide.
 *
 * @module
 */

/** Numeric parts of a `major.minor.patch[-pre]` version; missing parts are 0. */
function parts(version: string): number[] {
  const core = version.trim().replace(/^v/, "").split(/[-+]/)[0];
  const nums = core.split(".").map((p) => Number.parseInt(p, 10));
  return [0, 1, 2].map((i) => (Number.isFinite(nums[i]) ? nums[i] : 0));
}

/** True when `a` is a lower version than `b` (prerelease tags are ignored). */
export function versionLessThan(a: string, b: string): boolean {
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i];
  }
  return false;
}

/**
 * A message when `plugin` needs a newer core than `coreVersion`, or null when
 * it is satisfied, declares nothing, or declares something unreadable (that is
 * the plugin's bug, not a reason to refuse it).
 */
export function coreRequirementProblem(
  plugin: { name: string; requiresCore?: unknown },
  coreVersion: string,
): string | null {
  const needs = plugin.requiresCore;
  if (typeof needs !== "string" || !/^v?\d+(\.\d+){0,2}/.test(needs.trim())) return null;
  if (!versionLessThan(coreVersion, needs)) return null;
  return `${plugin.name} needs @dune/core ${needs.trim()} or later, but this is ${coreVersion}. ` +
    `Upgrade @dune/core, or use an older release of ${plugin.name}.`;
}
