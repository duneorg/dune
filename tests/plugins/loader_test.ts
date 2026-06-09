/**
 * Tests for plugin specifier validation (M-5): cleartext http: is rejected.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isValidPluginIslandSpecifier } from "../../src/plugins/loader.ts";

Deno.test("isValidPluginIslandSpecifier: rejects cleartext http: (M-5)", () => {
  assertEquals(isValidPluginIslandSpecifier("http://evil.example.com/plugin.ts"), false);
});

Deno.test("isValidPluginIslandSpecifier: accepts secure and registry schemes", () => {
  assertEquals(isValidPluginIslandSpecifier("https://example.com/plugin.ts"), true);
  assertEquals(isValidPluginIslandSpecifier("jsr:@scope/plugin@1.0.0"), true);
  assertEquals(isValidPluginIslandSpecifier("npm:dune-plugin"), true);
  assertEquals(isValidPluginIslandSpecifier("/abs/path/plugin.ts"), true);
});

Deno.test("isValidPluginIslandSpecifier: rejects relative, NUL, and traversal specs", () => {
  assertEquals(isValidPluginIslandSpecifier("./plugin.ts"), false);
  assertEquals(isValidPluginIslandSpecifier("/abs/../escape.ts"), false);
  assertEquals(isValidPluginIslandSpecifier("/abs/with\0nul.ts"), false);
  assertEquals(isValidPluginIslandSpecifier(""), false);
  assertEquals(isValidPluginIslandSpecifier(123 as unknown), false);
});
