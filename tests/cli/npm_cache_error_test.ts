/**
 * Tests for npm-cache-error.ts, using the actual error text from
 * duneorg/dune#2 as fixtures.
 */

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  formatNpmCacheMismatchError,
  isNpmCacheMismatchError,
} from "../../src/cli/npm-cache-error.ts";

// Verbatim from the issue's pasted build output.
const REAL_ERROR_1 = new Error(
  `Could not resolve 'npm:preact@^10.29.1/hooks': [ERR_MODULE_NOT_FOUND] ` +
    `Cannot find module 'file:///home/ubuntuuser/.cache/deno/npm/registry.npmjs.org/preact/10.29.8_1/hooks' ` +
    `imported from 'https://jsr.io/@fresh/core/2.3.3/src/runtime/client/preact_hooks_client.ts'`,
);

const REAL_ERROR_2 = new Error(
  `Could not find referrer npm package ` +
    `'file:///home/ubuntuuser/.cache/deno/npm/registry.npmjs.org/@preact/signals/2.11.0/dist/signals.module.js' ` +
    `(@preact/signals@2.11.0).`,
);

const REAL_ERROR_3 = new Error(
  `[ERR_MODULE_NOT_FOUND] Cannot find module ` +
    `'file:///home/ubuntuuser/.cache/deno/npm/registry.npmjs.org/preact/10.29.8_1/index.js' ` +
    `imported from 'file:///home/ubuntuuser/.cache/deno/npm/registry.npmjs.org/preact-render-to-string/6.7.0/dist/index.module.js'`,
);

Deno.test("isNpmCacheMismatchError: matches all three real error shapes from duneorg/dune#2", () => {
  assertEquals(isNpmCacheMismatchError(REAL_ERROR_1), true);
  assertEquals(isNpmCacheMismatchError(REAL_ERROR_2), true);
  assertEquals(isNpmCacheMismatchError(REAL_ERROR_3), true);
});

Deno.test("isNpmCacheMismatchError: does not match unrelated errors", () => {
  assertEquals(isNpmCacheMismatchError(new Error("some other failure")), false);
  assertEquals(
    isNpmCacheMismatchError(new Error('Import "foo" not in import map')),
    false,
  );
  assertEquals(isNpmCacheMismatchError("not an error"), false);
});

Deno.test("isNpmCacheMismatchError: does not false-positive on an npm path with no ERR_MODULE_NOT_FOUND/referrer signature", () => {
  const benign = new Error(
    "Some unrelated message mentioning npm/registry.npmjs.org/foo/1.0.0/bar.js in passing",
  );
  assertEquals(isNpmCacheMismatchError(benign), false);
});

Deno.test("formatNpmCacheMismatchError: suggests deno cache --reload and the cache-clear paths", () => {
  const msg = formatNpmCacheMismatchError(REAL_ERROR_1);
  assertStringIncludes(msg, "deno cache --reload");
  assertStringIncludes(msg, "~/.cache/deno/npm");
  assertStringIncludes(msg, "not a Dune problem");
});

Deno.test("formatNpmCacheMismatchError: extracts and names the two conflicting versions", () => {
  const msg = formatNpmCacheMismatchError(REAL_ERROR_1);
  assertStringIncludes(msg, "preact@10.29.8");
});

Deno.test("formatNpmCacheMismatchError: includes the original error text for context", () => {
  const msg = formatNpmCacheMismatchError(REAL_ERROR_2);
  assertStringIncludes(msg, "Could not find referrer npm package");
});
