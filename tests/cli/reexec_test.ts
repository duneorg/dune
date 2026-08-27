/**
 * Regression test for reexec.ts's cli.ts URL resolution.
 *
 * The bug (found live against @dune/core@0.34.0 from JSR): reexec.ts lives
 * at src/cli/reexec.ts, but `new URL("./cli.ts", import.meta.url)` resolves
 * relative to that file's own directory (src/cli/), landing on the
 * nonexistent src/cli/cli.ts instead of the real entrypoint at src/cli.ts.
 * Only manifests for a non-file:// (jsr:-resolved) load, which is why the
 * rest of the test suite — running against the local file:// checkout —
 * never caught it. This test resolves the same way reexec.ts does and
 * verifies the target actually exists, so a regression to "./cli.ts" (or
 * any other wrong relative path) fails immediately regardless of how the
 * module happens to be loaded when the suite runs.
 */

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fromFileUrl } from "@std/path";
import { resolveCliEntryUrl } from "../../src/cli/reexec.ts";

Deno.test("resolveCliEntryUrl: points at the real src/cli.ts entrypoint, not src/cli/cli.ts", async () => {
  const url = resolveCliEntryUrl();
  assertStringIncludes(url, "/src/cli.ts");

  const path = fromFileUrl(url);
  const stat = await Deno.stat(path);
  assertEquals(stat.isFile, true);

  // The actual bug shape: same directory as reexec.ts itself.
  assertEquals(path.endsWith("/src/cli/cli.ts"), false);
});
