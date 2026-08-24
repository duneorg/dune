import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  assertHttpsPluginIntegrity,
  assertPinnedPluginSpecifier,
  isRemotePluginSpecifier,
  parsePluginIntegrity,
} from "../../src/plugins/reference.ts";

Deno.test("isRemotePluginSpecifier: jsr and npm", () => {
  assertEquals(isRemotePluginSpecifier("jsr:@dune/plugin-seo@1.0.0"), true);
  assertEquals(isRemotePluginSpecifier("npm:some-plugin@1.0.0"), true);
  assertEquals(isRemotePluginSpecifier("./plugins/my-plugin.ts"), false);
  assertEquals(isRemotePluginSpecifier("https://example.com/plugin.ts"), false);
});

Deno.test("assertPinnedPluginSpecifier: requires a version, exact or ^/~ range, for jsr/npm", () => {
  assertThrows(
    () => assertPinnedPluginSpecifier("jsr:@dune/plugin-seo"),
    Error,
    "version",
  );
  assertPinnedPluginSpecifier("jsr:@dune/plugin-seo@1.0.0");
  assertPinnedPluginSpecifier("jsr:@dune/plugin-seo@^1.0.0");
  assertPinnedPluginSpecifier("jsr:@dune/plugin-seo@~1.0.0");
  assertPinnedPluginSpecifier("jsr:@dune/plugin-seo@^1");
  assertPinnedPluginSpecifier("npm:@scope/pkg@2.1.0");
});

Deno.test("assertPinnedPluginSpecifier: no-op for local paths and https", () => {
  assertPinnedPluginSpecifier("./plugins/my-plugin.ts");
  assertPinnedPluginSpecifier("../shared/plugin.ts");
  assertPinnedPluginSpecifier("/abs/plugin.ts");
  assertPinnedPluginSpecifier("https://example.com/plugin.ts");
});

Deno.test("assertHttpsPluginIntegrity: requires a pin on https: src", () => {
  assertThrows(
    () => assertHttpsPluginIntegrity("https://example.com/plugin.ts", undefined),
    Error,
    "integrity",
  );
  assertHttpsPluginIntegrity(
    "https://example.com/plugin.ts",
    `sha256:${"ab".repeat(32)}`,
  );
  assertHttpsPluginIntegrity("./plugins/local.ts", undefined);
});

Deno.test("parsePluginIntegrity: accepts sha256 hex and SRI base64", () => {
  const hex = "ab".repeat(32);
  assertEquals(parsePluginIntegrity(`sha256:${hex}`).hex, hex);
  const bytes = new Uint8Array(32).fill(0xab);
  const b64 = btoa(String.fromCharCode(...bytes));
  assertEquals(parsePluginIntegrity(`sha256-${b64}`).hex, hex);
});
