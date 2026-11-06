/**
 * Tests for plugin specifier validation (M-5): cleartext http: is rejected.
 */

import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isValidPluginIslandSpecifier, loadPlugins } from "../../src/plugins/loader.ts";
import { createHookRegistry } from "../../src/hooks/registry.ts";
import type { DuneConfig } from "../../src/config/types.ts";
import type { StorageAdapter } from "../../src/storage/types.ts";

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

Deno.test("loadPlugins: refuses to import a bare (unversioned) jsr: specifier", async () => {
  const config = {
    pluginList: [{ src: "jsr:@dune/plugin-seo" }],
    autoDiscoverPlugins: false,
    plugins: {},
  } as unknown as DuneConfig;
  const storage = { exists: () => Promise.resolve(false) } as unknown as StorageAdapter;
  const hooks = createHookRegistry({ config, storage });

  await assertRejects(
    () => loadPlugins({ config, hooks, storage, root: "/tmp" }),
    Error,
    "version",
  );
});

Deno.test("loadPlugins: accepts a ^-range jsr: specifier past version validation", async () => {
  const config = {
    pluginList: [{ src: "jsr:@dune/plugin-seo@^1.0.0" }],
    autoDiscoverPlugins: false,
    plugins: {},
  } as unknown as DuneConfig;
  const storage = { exists: () => Promise.resolve(false) } as unknown as StorageAdapter;
  const hooks = createHookRegistry({ config, storage });

  // The version-anchoring check now accepts ^/~ ranges (b80673a). A failed
  // module resolution is caught internally and only logged (loadPlugins
  // never throws for that), so simply resolving without throwing confirms
  // the specifier made it past the version-anchoring check.
  await loadPlugins({ config, hooks, storage, root: "/tmp" });
});

Deno.test("loadPlugins: a plugin factory gets its config and the site root and dev flag", async () => {
  const root = await Deno.makeTempDir({ prefix: "dune_test_factory_ctx_" });
  try {
    await Deno.mkdir(`${root}/plugins`, { recursive: true });
    await Deno.writeTextFile(
      `${root}/plugins/factory.ts`,
      `export default function (cfg: unknown, ctx: unknown) {
         (globalThis as any).__factoryArgs = { cfg, ctx };
         return { name: "factory-plugin", version: "1.0.0", hooks: {} };
       }`,
    );
    const config = {
      pluginList: [{ src: "./plugins/factory.ts", config: { a: 1 } }],
      autoDiscoverPlugins: false,
      plugins: {},
    } as unknown as DuneConfig;
    const storage = { exists: () => Promise.resolve(false) } as unknown as StorageAdapter;

    for (const dev of [undefined, true]) {
      const hooks = createHookRegistry({ config, storage });
      await loadPlugins({ config, hooks, storage, root, dev });
      // deno-lint-ignore no-explicit-any
      const seen = (globalThis as any).__factoryArgs;
      assertEquals(seen.cfg, { a: 1 });
      assertEquals(seen.ctx, { root, dev: dev ?? false });
      assertEquals(hooks.plugins().map((p) => p.name), ["factory-plugin"]);
    }
  } finally {
    // deno-lint-ignore no-explicit-any
    delete (globalThis as any).__factoryArgs;
    await Deno.remove(root, { recursive: true });
  }
});
