import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import { join } from "@std/path";
import { App } from "fresh";
import { bootstrap } from "../../src/runtime/bootstrap.ts";
import { mountPlugins } from "../../src/plugins/loader.ts";
import { createPluginRuntime, type PluginRuntime } from "../../src/plugin-api/runtime.ts";
import type { DunePlugin } from "../../src/hooks/types.ts";

async function site(): Promise<string> {
  const root = await Deno.makeTempDir({ prefix: "dune_test_runtime_" });
  await Deno.mkdir(join(root, "content", "01.home"), { recursive: true });
  await Deno.writeTextFile(join(root, "content", "01.home", "default.md"), "---\ntitle: Home\n---\n\n# Home\n");
  return root;
}

Deno.test(
  "PluginRuntime: a curated slice of the bootstrap result, nothing of core's wiring",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    const root = await site();
    try {
      const boot = await bootstrap(root);
      const runtime = createPluginRuntime(boot);

      // The same instances core uses, not copies.
      assertStrictEquals(runtime.engine, boot.engine);
      assertStrictEquals(runtime.hooks, boot.hooks);
      assertStrictEquals(runtime.storage, boot.storage);
      assertStrictEquals(runtime.config, boot.config);
      assertStrictEquals(runtime.history, boot.history);

      // Exactly the documented surface. Core's own wiring (the HMAC key, the
      // capability registry, the format registry, image handler, plugin asset
      // dirs, ...) is not reachable.
      assertEquals(
        Object.keys(runtime).sort(),
        [
          "authz", "config", "contentApi", "engine", "flexEngine", "history", "hooks", "imageCache",
          "jobs", "metrics", "search", "sections", "storage", "submissions",
        ].sort(),
      );
      for (const leaked of ["hmacKey", "capabilityRegistry", "pluginServices", "authzAdapter", "formats", "imageHandler"]) {
        assert(!(leaked in runtime), `${leaked} must not be reachable from the runtime`);
      }
    } finally {
      await Deno.remove(root, { recursive: true }).catch(() => {});
    }
  },
);

Deno.test(
  "PluginRuntime.jobs is read lazily: the scheduler appears after mount()",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    const root = await site();
    try {
      const boot = await bootstrap(root);
      const runtime = createPluginRuntime(boot);
      assertEquals(runtime.jobs, undefined);
      const scheduler = {} as NonNullable<typeof boot.jobScheduler>;
      boot.jobScheduler = scheduler; // what `dune serve` does once it has one
      assertStrictEquals(runtime.jobs, scheduler);
    } finally {
      await Deno.remove(root, { recursive: true }).catch(() => {});
    }
  },
);

Deno.test(
  "mountPlugins: mount() receives the runtime and no bootstrap result",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    const root = await site();
    try {
      let seen: (PluginRuntime & { bootstrap?: unknown }) | undefined;
      let sawBootstrap: boolean | undefined;
      const plugin: DunePlugin = {
        name: "runtime-probe",
        version: "1.0.0",
        hooks: {},
        mount(api) {
          seen = api.runtime;
          sawBootstrap = "bootstrap" in api;
        },
      };
      const boot = await bootstrap(root, { plugins: [plugin] });
      // deno-lint-ignore no-explicit-any
      await mountPlugins(new App<any>(), boot);
      assertStrictEquals(seen?.engine, boot.engine);
      assertEquals(sawBootstrap, false);
    } finally {
      await Deno.remove(root, { recursive: true }).catch(() => {});
    }
  },
);
