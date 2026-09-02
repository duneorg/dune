/**
 * Regression test for a plugin-mounting order bug: a plugin registered
 * before the built-in admin plugin (the normal case — see `bootstrap.ts`'s
 * step ordering, where `loadPlugins()` registers every site-configured
 * plugin at step 5b and the admin plugin isn't registered until step 12)
 * could never see state set by admin's own `mount()`-registered middleware,
 * because Fresh 2 snapshots a route's middleware chain at the point the
 * route itself is registered (`@fresh/core`'s `applyCommandsInner` /
 * `segmentToMiddlewares`) — middleware registered by a *later* `mount()`
 * call is invisible to a route a plugin registered in an *earlier* one,
 * even when both are unscoped (`app.use()` with no path).
 *
 * This is exactly the shape of the real bug: a third-party plugin's own
 * `mount()`-registered route calling `@dune/plugin-admin`'s `withGuards()`
 * helper, which reads `ctx.state.adminContext` — populated by an `app.use()`
 * middleware plugin-admin's own `mount()` registers. `ctx.state.adminContext`
 * read back as `undefined` no matter how the request was authenticated,
 * because the user plugin's route had already been compiled without it.
 *
 * `mountPlugins()` now calls every plugin's `mountEarly()` hook — admin
 * first (identified by `ADMIN_PLUGIN_NAME`), regardless of registration
 * order — before calling any plugin's `mount()`. See `mountPlugins()`'s doc
 * comment in `src/plugins/loader.ts` for why that's a separate pass from
 * `mount()` rather than just reordering `mount()` itself (a naive reorder
 * breaks a different invariant `tests/runtime/register_plugin_routes_test.ts`
 * guards). This test stands in for the real admin plugin with a synthetic
 * one (core can't depend on `@dune/plugin-admin` — see
 * `src/plugins/builtin.ts`'s doc comment on the circular publish dependency)
 * to exercise the actual mechanism: Fresh route/middleware registration
 * order via a real `App` and a real in-process request.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { join } from "@std/path";
import { App } from "fresh";
import { bootstrap } from "../../src/runtime/bootstrap.ts";
import { mountPlugins } from "../../src/plugins/loader.ts";
import { ADMIN_PLUGIN_NAME } from "../../src/plugins/builtin.ts";
import type { DunePlugin } from "../../src/hooks/types.ts";

Deno.test(
  "mountPlugins: a plugin registered before the admin plugin still sees " +
    "state set by admin's mount()-registered middleware",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    const root = await Deno.makeTempDir({
      prefix: "dune_test_admin_mount_order_",
    });
    try {
      await Deno.mkdir(join(root, "content", "01.home"), { recursive: true });
      await Deno.writeTextFile(
        join(root, "content", "01.home", "default.md"),
        "---\ntitle: Home\n---\n\n# Home\n",
      );

      // Registration order mirrors bootstrap.ts's real ordering: a
      // site-configured plugin registers (and later mounts) before the
      // built-in admin plugin does — the exact precondition the bug needs.
      const userPlugin: DunePlugin = {
        name: "test-user-plugin",
        version: "1.0.0",
        hooks: {},
        mount({ app }) {
          app.get("/user-route", (fc) => {
            // deno-lint-ignore no-explicit-any
            const flag = (fc.state as any).sharedFlag ?? "MISSING";
            return new Response(flag);
          });
        },
      };

      const fakeAdminPlugin: DunePlugin = {
        name: ADMIN_PLUGIN_NAME,
        version: "1.0.0",
        hooks: {},
        mountEarly({ app }) {
          app.use((fc) => {
            // deno-lint-ignore no-explicit-any
            (fc.state as any).sharedFlag = "SET";
            return fc.next();
          });
        },
      };

      const ctx = await bootstrap(root, {
        plugins: [userPlugin, fakeAdminPlugin],
        // Disable the real built-in admin plugin — it would otherwise also
        // register (also named ADMIN_PLUGIN_NAME) and this test cares only
        // about the reordering mechanism, not the real plugin's behavior.
        // deno-lint-ignore no-explicit-any
        configOverrides: { admin: { enabled: false } as any },
      });
      // deno-lint-ignore no-explicit-any
      const app = new App<any>();
      await mountPlugins(app, ctx);

      const handler = app.handler();
      const res = await handler(
        new Request("http://localhost:8000/user-route"),
      );
      assertEquals(await res.text(), "SET");
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
