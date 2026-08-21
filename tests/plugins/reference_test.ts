import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { assertPinnedPluginSpecifier, isRemotePluginSpecifier } from "../../src/plugins/reference.ts";

Deno.test("isRemotePluginSpecifier: jsr and npm", () => {
  assertEquals(isRemotePluginSpecifier("jsr:@dune/plugin-seo@1.0.0"), true);
  assertEquals(isRemotePluginSpecifier("npm:some-plugin@1.0.0"), true);
  assertEquals(isRemotePluginSpecifier("./plugins/my-plugin.ts"), false);
  assertEquals(isRemotePluginSpecifier("https://example.com/plugin.ts"), false);
});

Deno.test("assertPinnedPluginSpecifier: requires exact semver for jsr/npm", () => {
  assertThrows(
    () => assertPinnedPluginSpecifier("jsr:@dune/plugin-seo@^1.0.0"),
    Error,
    "pinned",
  );
  assertThrows(
    () => assertPinnedPluginSpecifier("jsr:@dune/plugin-seo"),
    Error,
    "pinned",
  );
  assertPinnedPluginSpecifier("jsr:@dune/plugin-seo@1.0.0");
  assertPinnedPluginSpecifier("npm:@scope/pkg@2.1.0");
});

Deno.test("assertPinnedPluginSpecifier: no-op for local paths and https", () => {
  assertPinnedPluginSpecifier("./plugins/my-plugin.ts");
  assertPinnedPluginSpecifier("../shared/plugin.ts");
  assertPinnedPluginSpecifier("/abs/plugin.ts");
  assertPinnedPluginSpecifier("https://example.com/plugin.ts");
});
