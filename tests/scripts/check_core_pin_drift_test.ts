/**
 * Tests for extractCoreRange() (scripts/check-core-pin-drift.ts) — the pure
 * parsing logic behind the CI guard that catches a sibling @dune/* package's
 * published @dune/core import range drifting out of coverage of this
 * checkout's own core version (the 2026-07-16 incident class).
 *
 * The script's network-fetching glue (fetchLatestVersion/fetchDenoJson/
 * main()) isn't covered here — it's exercised by actually running the
 * script, matching how scripts/lint-dynamic-imports.ts (no test file) is
 * treated elsewhere in this repo.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractCoreRange } from "../../scripts/check-core-pin-drift.ts";

Deno.test("extractCoreRange: finds a bare-minor pin", () => {
  const range = extractCoreRange({
    imports: { "@dune/core": "jsr:@dune/core@0.31" },
  });
  assertEquals(range, "0.31");
});

Deno.test("extractCoreRange: finds a caret-range pin", () => {
  const range = extractCoreRange({
    imports: { "@dune/core": "jsr:@dune/core@^0.31.2" },
  });
  assertEquals(range, "^0.31.2");
});

Deno.test("extractCoreRange: finds an exact-version pin", () => {
  const range = extractCoreRange({
    imports: { "@dune/core": "jsr:@dune/core@0.31.7" },
  });
  assertEquals(range, "0.31.7");
});

Deno.test("extractCoreRange: finds the pin among unrelated import entries", () => {
  const range = extractCoreRange({
    imports: {
      "fresh": "jsr:@fresh/core@^2",
      "@dune/core": "jsr:@dune/core@^0.31",
      "preact": "npm:preact@^10",
    },
  });
  assertEquals(range, "^0.31");
});

Deno.test("extractCoreRange: finds the pin from a subpath entry, stripping the subpath suffix", () => {
  const range = extractCoreRange({
    imports: { "@dune/core/search": "jsr:@dune/core@^0.31/search" },
  });
  assertEquals(range, "^0.31");
});

Deno.test("extractCoreRange: returns null when no @dune/core import exists", () => {
  const range = extractCoreRange({
    imports: { "fresh": "jsr:@fresh/core@^2" },
  });
  assertEquals(range, null);
});

Deno.test("extractCoreRange: returns null when imports is undefined", () => {
  const range = extractCoreRange({});
  assertEquals(range, null);
});

Deno.test("extractCoreRange: returns null for an empty imports map", () => {
  const range = extractCoreRange({ imports: {} });
  assertEquals(range, null);
});
