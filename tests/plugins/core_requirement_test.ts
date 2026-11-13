/**
 * `DunePlugin.requiresCore`: a plugin that needs a newer core than the running
 * one is skipped with a clear message.
 */
import { assertEquals, assertStringIncludes } from "@std/assert";
import { coreRequirementProblem, versionLessThan } from "../../src/plugins/core-requirement.ts";
import { loadPlugins } from "../../src/plugins/loader.ts";
import { CORE_VERSION } from "../../src/plugins/mod.ts";
import { createHookRegistry } from "../../src/hooks/registry.ts";
import type { DuneConfig } from "../../src/config/types.ts";
import type { StorageAdapter } from "../../src/storage/types.ts";

Deno.test("versionLessThan compares numerically, not as strings", () => {
  assertEquals(versionLessThan("0.9.0", "0.10.0"), true);
  assertEquals(versionLessThan("0.37.0", "0.37.1"), true);
  assertEquals(versionLessThan("0.37.1", "0.37.0"), false);
  assertEquals(versionLessThan("0.37.0", "0.37.0"), false);
  assertEquals(versionLessThan("1.0.0", "0.99.99"), false);
  assertEquals(versionLessThan("0.37", "0.37.0"), false);
  assertEquals(versionLessThan("0.37.0-rc.1", "0.37.0"), false);
});

Deno.test("coreRequirementProblem: satisfied, too old, absent, unreadable", () => {
  assertEquals(coreRequirementProblem({ name: "p" }, "0.37.0"), null);
  assertEquals(coreRequirementProblem({ name: "p", requiresCore: "0.37.0" }, "0.37.0"), null);
  assertEquals(coreRequirementProblem({ name: "p", requiresCore: "0.36.1" }, "0.37.0"), null);
  assertEquals(coreRequirementProblem({ name: "p", requiresCore: "garbage" }, "0.37.0"), null);
  assertEquals(coreRequirementProblem({ name: "p", requiresCore: 5 }, "0.37.0"), null);
  const problem = coreRequirementProblem({ name: "admin", requiresCore: "0.38.0" }, "0.37.0");
  assertStringIncludes(problem ?? "", "admin needs @dune/core 0.38.0 or later");
  assertStringIncludes(problem ?? "", "this is 0.37.0");
});

Deno.test("loadPlugins skips a plugin that needs a newer core and loads one that does not", async () => {
  const root = await Deno.makeTempDir({ prefix: "dune_test_requires_core_" });
  try {
    await Deno.mkdir(`${root}/plugins`, { recursive: true });
    await Deno.writeTextFile(
      `${root}/plugins/too-new.ts`,
      `export default { name: "too-new", version: "1.0.0", requiresCore: "999.0.0", hooks: {} };`,
    );
    await Deno.writeTextFile(
      `${root}/plugins/fine.ts`,
      `export default { name: "fine", version: "1.0.0", requiresCore: ${
        JSON.stringify(CORE_VERSION)
      }, hooks: {} };`,
    );
    const config = {
      pluginList: [],
      autoDiscoverPlugins: true,
      plugins: {},
    } as unknown as DuneConfig;
    const storage = {
      exists: (p: string) => Promise.resolve(p === `${root}/plugins`),
      list: () =>
        Promise.resolve([
          {
            name: "too-new.ts",
            path: `${root}/plugins/too-new.ts`,
            isFile: true,
            isDirectory: false,
          },
          { name: "fine.ts", path: `${root}/plugins/fine.ts`, isFile: true, isDirectory: false },
        ]),
    } as unknown as StorageAdapter;
    const hooks = createHookRegistry({ config, storage });
    await loadPlugins({ config, hooks, storage, root });
    assertEquals(hooks.plugins().map((p) => p.name), ["fine"]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
