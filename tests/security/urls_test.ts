import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isSafeUrl, safeUrl } from "../../src/security/urls.ts";

Deno.test("isSafeUrl: empty and anchor", () => {
  assert(isSafeUrl(""));
  assert(isSafeUrl("#"));
  assert(isSafeUrl("#section"));
});

Deno.test("isSafeUrl: relative paths", () => {
  assert(isSafeUrl("/"));
  assert(isSafeUrl("/foo"));
  assert(isSafeUrl("/foo/bar?x=1"));
  assert(isSafeUrl("./foo"));
  assert(isSafeUrl("../foo"));
  assert(isSafeUrl("foo"));
  assert(isSafeUrl("foo/bar"));
});

Deno.test("isSafeUrl: http and https", () => {
  assert(isSafeUrl("http://example.com"));
  assert(isSafeUrl("https://example.com/path?q=1"));
});

Deno.test("isSafeUrl: mailto and tel", () => {
  assert(isSafeUrl("mailto:user@example.com"));
  assert(isSafeUrl("tel:+1-555-1234"));
});

Deno.test("isSafeUrl: rejects javascript:", () => {
  assertFalse(isSafeUrl("javascript:alert(1)"));
  assertFalse(isSafeUrl("JavaScript:alert(1)"));
  assertFalse(isSafeUrl("JAVASCRIPT:alert(1)"));
});

Deno.test("isSafeUrl: rejects vbscript:, data:, file:", () => {
  assertFalse(isSafeUrl("vbscript:msgbox(1)"));
  assertFalse(isSafeUrl("data:text/html,<script>alert(1)</script>"));
  assertFalse(isSafeUrl("file:///etc/passwd"));
});

Deno.test("isSafeUrl: rejects control-char obfuscation", () => {
  assertFalse(isSafeUrl("java\tscript:alert(1)"));
  assertFalse(isSafeUrl("java\nscript:alert(1)"));
  assertFalse(isSafeUrl("\x00javascript:alert(1)"));
});

Deno.test("isSafeUrl: rejects leading whitespace", () => {
  assertFalse(isSafeUrl(" javascript:alert(1)"));
  assertFalse(isSafeUrl("\tjavascript:alert(1)"));
});

Deno.test("isSafeUrl: rejects unknown schemes", () => {
  assertFalse(isSafeUrl("gopher://example.com"));
  assertFalse(isSafeUrl("ftp://example.com"));
  assertFalse(isSafeUrl("ws://example.com"));
});

Deno.test("isSafeUrl: null/undefined", () => {
  assertFalse(isSafeUrl(null));
  assertFalse(isSafeUrl(undefined));
});

Deno.test("safeUrl: returns url if safe", () => {
  assertEquals(safeUrl("/foo"), "/foo");
  assertEquals(safeUrl("https://x.com"), "https://x.com");
});

Deno.test("safeUrl: returns fallback if unsafe", () => {
  assertEquals(safeUrl("javascript:alert(1)"), "#");
  assertEquals(safeUrl("javascript:alert(1)", "/"), "/");
});
