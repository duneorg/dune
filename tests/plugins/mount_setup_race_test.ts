/**
 * Regression test for a race between `registerPlugin()`'s fire-and-forget
 * `setup()` call and `mountPlugins()`'s `mount()` call.
 *
 * `registry.ts`'s `registerPlugin()` intentionally does not await
 * `plugin.setup()` when it returns a Promise (see its own doc comment).
 * `mountPlugins()` (loader.ts) used to call every plugin's `mount()` shortly
 * after, with no guarantee `setup()` had resolved first. A plugin with a
 * slow async `setup()` (e.g. `@dune/plugin-admin`'s `auditLogger.init()`)
 * could therefore have `mount()` run against state `setup()` hadn't
 * finished initializing yet — silently, no error anywhere.
 *
 * `mountPlugins()` now awaits `hooks.whenSetupComplete()` before calling any
 * plugin's `mount()`. This test uses a plugin whose `setup()` deliberately
 * outlives several microtask turns before flipping its internal state, and
 * asserts `mount()` observes the fully-initialized value.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { join } from "@std/path";
import { App } from "fresh";
import { bootstrap } from "../../src/runtime/bootstrap.ts";
import { mountPlugins } from "../../src/plugins/loader.ts";
import type { DunePlugin } from "../../src/hooks/types.ts";

Deno.test(
  "mountPlugins: mount() sees state set by a slow async setup()",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    const root = await Deno.makeTempDir({
      prefix: "dune_test_mount_setup_race_",
    });
    try {
      await Deno.mkdir(join(root, "content", "01.home"), { recursive: true });
      await Deno.writeTextFile(
        join(root, "content", "01.home", "default.md"),
        "---\ntitle: Home\n---\n\n# Home\n",
      );

      let setupState: string | null = null;
      let seenBySetupAtMount: string | null = "not-run";

      const slowPlugin: DunePlugin = {
        name: "test-slow-setup-plugin",
        version: "1.0.0",
        hooks: {},
        async setup() {
          // Several real async hops — mirrors e.g. auditLogger.init()
          // doing file I/O before setup completes.
          for (let i = 0; i < 5; i++) {
            await new Promise((r) => setTimeout(r, 1));
          }
          setupState = "initialized";
        },
        mount() {
          // Mirrors @dune/plugin-admin's mount() gate: `if (!setupState)
          // return` — silently no-ops if setup() hasn't finished.
          seenBySetupAtMount = setupState;
        },
      };

      const ctx = await bootstrap(root, { plugins: [slowPlugin] });
      // deno-lint-ignore no-explicit-any
      const app = new App<any>();
      await mountPlugins(app, ctx);

      assertEquals(setupState, "initialized");
      assertEquals(seenBySetupAtMount, "initialized");
    } finally {
      await removeWithRetry(root);
    }
  },
);

async function removeWithRetry(root: string): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await Deno.remove(root, { recursive: true });
      return;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  throw lastErr;
}
