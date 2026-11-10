/**
 * Core-instance handshake: the plugin loader's check that a dynamically imported
 * plugin resolved the SAME @dune/core module instance as the host —
 * compared by sentinel reference, not version string, so a same-version
 * dual-load (local-path core + JSR-resolved core) is caught too.
 */

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { pluginCoreMismatch } from "../../src/plugins/core-handshake.ts";
import { CORE_INSTANCE, CORE_VERSION } from "../../src/plugins/mod.ts";

Deno.test("pluginCoreMismatch: null when the plugin resolved this core instance", () => {
  assertEquals(
    pluginCoreMismatch({ resolvedCoreSentinel: CORE_INSTANCE, resolvedCoreVersion: CORE_VERSION }, "some-plugin"),
    null,
  );
});

Deno.test("pluginCoreMismatch: null for plugins that predate the handshake", () => {
  assertEquals(pluginCoreMismatch({ createAdminPlugin: () => {} }, "some-plugin"), null);
});

Deno.test("pluginCoreMismatch: warns on a different core version", () => {
  const msg = pluginCoreMismatch({
    resolvedCoreSentinel: Object.freeze({}),
    resolvedCoreVersion: "0.27.0",
  }, "some-plugin");
  assertStringIncludes(msg ?? "", "@dune/core@0.27.0");
  assertStringIncludes(msg ?? "", `@dune/core@${CORE_VERSION}`);
  assertStringIncludes(msg ?? "", "version range");
});

Deno.test("pluginCoreMismatch: same version, different instance → local-path hint", () => {
  const msg = pluginCoreMismatch({
    resolvedCoreSentinel: Object.freeze({}),
    resolvedCoreVersion: CORE_VERSION,
  }, "some-plugin");
  assertStringIncludes(msg ?? "", "Same version loaded twice");
});

Deno.test("pluginCoreMismatch: sentinel export present but undefined → plugin resolved a pre-0.31 core", () => {
  const msg = pluginCoreMismatch({ resolvedCoreSentinel: undefined }, "some-plugin");
  assertStringIncludes(msg ?? "", "pre-0.31");
});
