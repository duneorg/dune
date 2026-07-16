/**
 * Static regression tests for the `jsr:@dune/plugin-admin` dynamic import
 * specifiers used to avoid a circular publish-time dependency between
 * @dune/core and @dune/plugin-admin.
 *
 * These imports intentionally use a non-literal string (assigned to a
 * variable before the `import()` call) so JSR's static publish-time analysis
 * doesn't flag a cycle. Two invariants hang off that non-literal-ness:
 *
 * 1. The specifiers must carry a version constraint — a bare
 *    `jsr:@dune/plugin-admin` resolves against whatever happens to be in the
 *    local module cache / deno.lock at runtime, which is not guaranteed to be
 *    the latest published version in a fresh environment.
 * 2. The import sites must use the shared constants from plugins/builtin.ts
 *    rather than inline strings — the lockfile discovery helper reports those
 *    same constants so `dune lockfile sync` covers what Deno's graph builder
 *    can't follow. An inline string at an import site silently reopens the
 *    "synced lockfile fails --frozen serve" gap.
 */

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ADMIN_MOUNT_SPECIFIER, ADMIN_PLUGIN_SPECIFIER } from "../../src/plugins/builtin.ts";

Deno.test("plugin-admin specifier constants carry a version constraint", () => {
  for (const specifier of [ADMIN_PLUGIN_SPECIFIER, ADMIN_MOUNT_SPECIFIER]) {
    assert(
      /^jsr:@dune\/plugin-admin@\S/.test(specifier),
      `specifier "${specifier}" is missing a version constraint (e.g. "@^1.0") — ` +
        `a bare jsr: specifier resolves non-deterministically at runtime`,
    );
  }
});

const IMPORT_SITES = [
  { file: "src/runtime/bootstrap.ts", constant: "ADMIN_PLUGIN_SPECIFIER" },
  { file: "src/multisite/manager.ts", constant: "ADMIN_MOUNT_SPECIFIER" },
  { file: "src/cli/lockfile-resolve-helper.ts", constant: "ADMIN_PLUGIN_SPECIFIER" },
  { file: "src/cli/lockfile-resolve-helper.ts", constant: "ADMIN_MOUNT_SPECIFIER" },
];

Deno.test("plugin-admin import sites and the lockfile helper share the builtin.ts constants", async () => {
  for (const { file, constant } of IMPORT_SITES) {
    const source = await Deno.readTextFile(new URL(`../../${file}`, import.meta.url));
    assert(
      source.includes(constant),
      `${file}: expected a reference to ${constant} from plugins/builtin.ts — ` +
        `an inline specifier string here would not be covered by dune lockfile sync`,
    );
    assert(
      !source.includes(`"${ADMIN_PLUGIN_SPECIFIER}"`) && !source.includes(`"${ADMIN_MOUNT_SPECIFIER}"`),
      `${file}: contains an inline plugin-admin specifier string; use the plugins/builtin.ts constant instead`,
    );
  }
});
