/**
 * Core-instance handshake: bootstrap's check that the dynamically imported
 * admin plugin resolved the SAME @dune/core module instance as the host —
 * compared by sentinel reference, not version string, so a same-version
 * dual-load (local-path core + JSR-resolved core) is caught too.
 */

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { adminCoreMismatch } from "../../src/plugins/builtin.ts";
import { CORE_INSTANCE, CORE_VERSION } from "../../src/plugins/mod.ts";

Deno.test("adminCoreMismatch: null when the plugin resolved this core instance", () => {
  assertEquals(
    adminCoreMismatch({ resolvedCoreSentinel: CORE_INSTANCE, resolvedCoreVersion: CORE_VERSION }),
    null,
  );
});

Deno.test("adminCoreMismatch: null for plugins that predate the handshake", () => {
  assertEquals(adminCoreMismatch({ createAdminPlugin: () => {} }), null);
});

Deno.test("adminCoreMismatch: warns on a different core version", () => {
  const msg = adminCoreMismatch({
    resolvedCoreSentinel: Object.freeze({}),
    resolvedCoreVersion: "0.27.0",
  });
  assertStringIncludes(msg ?? "", "@dune/core@0.27.0");
  assertStringIncludes(msg ?? "", `@dune/core@${CORE_VERSION}`);
  assertStringIncludes(msg ?? "", "version range");
});

Deno.test("adminCoreMismatch: same version, different instance → local-path hint", () => {
  const msg = adminCoreMismatch({
    resolvedCoreSentinel: Object.freeze({}),
    resolvedCoreVersion: CORE_VERSION,
  });
  assertStringIncludes(msg ?? "", "Same version loaded twice");
});

Deno.test("adminCoreMismatch: sentinel export present but undefined → plugin resolved a pre-0.31 core", () => {
  const msg = adminCoreMismatch({ resolvedCoreSentinel: undefined });
  assertStringIncludes(msg ?? "", "pre-0.31");
});
