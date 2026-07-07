/**
 * Static regression test for the `jsr:@dune/plugin-admin` dynamic import
 * specifiers used to avoid a circular publish-time dependency between
 * @dune/core and @dune/plugin-admin.
 *
 * These imports intentionally use a non-literal string (assigned to a const
 * before the `import()` call) so JSR's static publish-time analysis doesn't
 * flag a cycle. But that same non-literal-ness means nothing forces the
 * specifier to carry a version constraint — a bare `jsr:@dune/plugin-admin`
 * resolves against whatever happens to be in the local module cache /
 * deno.lock at runtime, which is not guaranteed to be the latest published
 * version in a fresh environment (new CI runner, fresh Docker image, etc).
 *
 * This test can't assert on network resolution (impractical in CI), but it
 * can assert the source specifiers aren't bare, so removing the version
 * constraint again would fail this test.
 */

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SPECIFIER_SITES = [
  { file: "src/runtime/bootstrap.ts", varName: "adminPkg" },
  { file: "src/multisite/manager.ts", varName: "adminMountPkg" },
];

Deno.test("plugin-admin dynamic import specifiers carry a version constraint", async () => {
  for (const { file, varName } of SPECIFIER_SITES) {
    const source = await Deno.readTextFile(
      new URL(`../../${file}`, import.meta.url),
    );
    const match = source.match(
      new RegExp(`const ${varName} = "(jsr:@dune/plugin-admin[^"]*)"`),
    );
    assert(
      match,
      `expected to find \`const ${varName} = "jsr:@dune/plugin-admin..."\` in ${file}`,
    );
    const specifier = match[1];
    assert(
      /@dune\/plugin-admin@\S/.test(specifier),
      `${file}: specifier "${specifier}" is missing a version constraint ` +
        `(e.g. "@^1.0") — a bare jsr: specifier resolves non-deterministically ` +
        `at runtime instead of using the pinned range from the import map`,
    );
  }
});
