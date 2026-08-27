/**
 * Tests for import-map-error.ts, including the stale-global-shim
 * disambiguation (duneorg/dune#6): when the missing specifier's top-level
 * package already has an entry in this checkout's own deno.json, the
 * message should point at `dune dev:link` instead of telling someone to add
 * an entry that's already there. Since tests run from within the real dune
 * checkout, real specifiers already in this repo's deno.json double as the
 * "stale shim" fixture without needing to mock the checkout lookup.
 */

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  formatImportMapError,
  isImportMapError,
} from "../../src/cli/import-map-error.ts";

function importMapError(specifier: string): Error {
  return new Error(`Import "${specifier}" not a dependency and not in import map`);
}

Deno.test("isImportMapError: matches both Deno error phrasings", () => {
  assertEquals(isImportMapError(importMapError("y-protocols/awareness")), true);
  assertEquals(
    isImportMapError(new Error('Import "foo" not in import map')),
    true,
  );
  assertEquals(isImportMapError(new Error("some other error")), false);
  assertEquals(isImportMapError("not an error"), false);
});

Deno.test("formatImportMapError: genuinely missing specifier gets the add-it-yourself message", async () => {
  const msg = await formatImportMapError(
    importMapError("totally-fake-package-xyz/sub"),
  );
  assertStringIncludes(msg, "isn't declared in deno.json");
  assertStringIncludes(msg, "deno add npm:totally-fake-package-xyz/sub");
});

Deno.test("formatImportMapError: specifier whose top-level package is already in this checkout's deno.json points at dev:link", async () => {
  // "@std/yaml" is a real, current entry in this repo's own deno.json.
  const msg = await formatImportMapError(importMapError("@std/yaml/some-subpath"));
  assertStringIncludes(msg, "shim's import map is just out of date");
  assertStringIncludes(msg, "dune dev:link");
});

Deno.test("formatImportMapError: bare (non-scoped) package works the same way", async () => {
  // "marked" is a real, current entry in this repo's own deno.json.
  const msg = await formatImportMapError(importMapError("marked/lib/marked.esm.js"));
  assertStringIncludes(msg, "dune dev:link");
});
