/**
 * Tests for the shared constant-time comparison helper.
 */

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { timingSafeEqualStrings } from "../../src/security/timing-safe.ts";

Deno.test("timingSafeEqualStrings: identical strings match", () => {
  assert(timingSafeEqualStrings("abc123", "abc123"));
  assert(timingSafeEqualStrings("", ""));
});

Deno.test("timingSafeEqualStrings: differing content does not match", () => {
  assertEquals(timingSafeEqualStrings("abc123", "abc124"), false);
  // Same length, single bit difference
  assertEquals(timingSafeEqualStrings("a", "b"), false);
});

Deno.test("timingSafeEqualStrings: differing lengths never match", () => {
  assertEquals(timingSafeEqualStrings("short", "shorter"), false);
  assertEquals(timingSafeEqualStrings("", "x"), false);
});

Deno.test("timingSafeEqualStrings: hex digests and base64url signatures", () => {
  const hexA = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
  assert(timingSafeEqualStrings(hexA, hexA));
  assertEquals(
    timingSafeEqualStrings(hexA, hexA.slice(0, -1) + "7"),
    false,
  );
});
