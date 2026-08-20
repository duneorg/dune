/**
 * Integration tests for src/runtime/register-plugin-routes.ts —
 * DunePlugin.publicRoutes actually working through createDuneApp() alone,
 * with no @dune/plugin-admin (or any admin package) involved at all.
 *
 * This is the real gap the fix closes: previously the only code that turned
 * a plugin's `publicRoutes` into a live Fresh route lived in
 * @dune/plugin-admin's mountDuneAdmin(), so a site with `admin.enabled:
 * false`, headless mode without an explicit mountDuneAdmin() call, or any
 * bootstrap()-only tool never got publicRoutes wired at all — silently, no
 * error. bootstrap.ts always collected BootstrapResult.pluginPublicRoutes;
 * nothing turned that into an app.get() call unless plugin-admin's mount()
 * happened to run. These tests boot a real engine + real Fresh App with no
 * admin package registered as a plugin at all, and drive real fetch
 * Requests through App.handler() — no mocking.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { join } from "@std/path";
import { App } from "fresh";
import { bootstrap } from "../../src/runtime/bootstrap.ts";
import { createDuneApp } from "../../src/runtime/server.ts";
import { registerPluginPublicRoutes } from "../../src/runtime/register-plugin-routes.ts";
import type { DunePlugin } from "../../src/hooks/types.ts";

async function withTestApp(
  plugins: DunePlugin[],
  fn: (handler: (req: Request) => Promise<Response>) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({
    prefix: "dune_test_plugin_public_routes_",
  });
  try {
    await Deno.mkdir(join(root, "content", "01.home"), { recursive: true });
    await Deno.writeTextFile(
      join(root, "content", "01.home", "default.md"),
      "---\ntitle: Home\n---\n\n# Home\n",
    );

    // No @dune/plugin-admin (or any admin package) is passed via `plugins`
    // below — this is the exact "admin package absent" scenario the fix
    // targets, since no site.yaml `plugins:` list or admin auto-registration
    // is involved when constructing the plugin array directly like this.
    const ctx = await bootstrap(root, { plugins });
    const { app } = await createDuneApp(ctx, { root, port: 0, dev: false });
    const handler = app.handler();

    await fn(handler);
  } finally {
    // bootstrap()'s file-watcher interval can still be writing (e.g. a
    // content-index cache file) for a moment after this test's assertions
    // run, which occasionally races a recursive remove with
    // "Directory not empty". Retry a few times rather than flake (same
    // pattern as tests/cli/validate_test.ts).
    for (let attempt = 0;; attempt++) {
      try {
        await Deno.remove(root, { recursive: true });
        break;
      } catch (err) {
        if (attempt >= 4) throw err;
        await new Promise((r) => setTimeout(r, 50));
      }
    }
  }
}

Deno.test(
  "registerPluginPublicRoutes: a plugin route resolves via createDuneApp() alone, no admin package present",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    const plugin: DunePlugin = {
      name: "test-public-route-plugin",
      version: "1.0.0",
      hooks: {},
      publicRoutes: [
        {
          path: "/newsletter/confirm",
          handler: () => new Response("confirmed", { status: 200 }),
        },
      ],
    };
    await withTestApp([plugin], async (handler) => {
      const res = await handler(
        new Request("http://localhost/newsletter/confirm"),
      );
      assertEquals(res.status, 200);
      assertEquals(await res.text(), "confirmed");
    });
  },
);

Deno.test(
  "registerPluginPublicRoutes: honors a non-GET method",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    const plugin: DunePlugin = {
      name: "test-post-route-plugin",
      version: "1.0.0",
      hooks: {},
      publicRoutes: [
        {
          path: "/webhook/custom",
          method: "POST",
          handler: async (fc) => {
            const body = await fc.req.text();
            return new Response(`got: ${body}`, { status: 200 });
          },
        },
      ],
    };
    await withTestApp([plugin], async (handler) => {
      const res = await handler(
        new Request("http://localhost/webhook/custom", {
          method: "POST",
          body: "hello",
        }),
      );
      assertEquals(res.status, 200);
      assertEquals(await res.text(), "got: hello");
    });
  },
);

Deno.test(
  "registerPluginPublicRoutes: rejects a route that shadows a reserved prefix",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    const plugin: DunePlugin = {
      name: "test-shadow-plugin",
      version: "1.0.0",
      hooks: {},
      publicRoutes: [
        {
          path: "/admin/hijack",
          handler: () => new Response("should never run", { status: 200 }),
        },
      ],
    };
    await withTestApp([plugin], async (handler) => {
      // No admin package is registered, so /admin/hijack isn't claimed by
      // real admin routes either — if the plugin route had registered, it
      // would answer with 200. It must not: the reserved-prefix check
      // rejects it regardless of whether the admin panel is actually
      // running, since the check is about the path shape, not runtime
      // admin state.
      const res = await handler(new Request("http://localhost/admin/hijack"));
      assertEquals(res.status !== 200, true);
    });
  },
);

Deno.test(
  "registerPluginPublicRoutes: publicRoutes handlers run after mount()-registered middleware from other plugins",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    // Regression test for a real bug: createDuneApp() used to call
    // registerPluginPublicRoutes() BEFORE mountPlugins(), so a route
    // registered via DunePlugin.publicRoutes could never see middleware
    // added by another plugin's mount() — including, in the real app,
    // @dune/plugin-admin's own `fc.state.adminContext = ...` middleware,
    // which plugin publicRoutes handlers rely on for manual auth (the
    // documented pattern for a mutating route — see e.g. eda-worksheets'
    // pdf-export plugin). Registering a route before that middleware exists
    // means the middleware chain built for that route never includes it.
    //
    // This uses two minimal fake plugins rather than the real
    // @dune/plugin-admin: plugin-admin's own admin-context middleware is
    // added from inside an async `setup()` that registry.ts intentionally
    // fire-and-forgets (see its own doc comment) with no ordering guarantee
    // relative to `mountPlugins()`, so exercising the real plugin here would
    // make this test flaky on a separate, unrelated race rather than testing
    // the ordering fix in server.ts. The two-plugin setup below isolates
    // exactly that ordering guarantee.
    let seenMarker: unknown;
    const middlewarePlugin: DunePlugin = {
      name: "test-middleware-plugin",
      version: "1.0.0",
      hooks: {},
      // deno-lint-ignore no-explicit-any
      mount({ app }: any) {
        app.use((fc: any) => {
          fc.state.marker = "set-by-mount";
          return fc.next();
        });
      },
    };
    const routePlugin: DunePlugin = {
      name: "test-route-plugin",
      version: "1.0.0",
      hooks: {},
      publicRoutes: [
        {
          path: "/probe-marker",
          // deno-lint-ignore no-explicit-any
          handler: (fc: any) => {
            seenMarker = fc.state?.marker;
            return new Response("ok", { status: 200 });
          },
        },
      ],
    };
    await withTestApp([middlewarePlugin, routePlugin], async (handler) => {
      const res = await handler(new Request("http://localhost/probe-marker"));
      assertEquals(res.status, 200);
      assertEquals(seenMarker, "set-by-mount");
    });
  },
);

Deno.test(
  "registerPluginPublicRoutes: calling twice for the same ctx is a no-op the second time",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    // This is exactly what happens in the real dune-serve path: createDuneApp()
    // calls this directly, and then @dune/plugin-admin's own mountDuneAdmin()
    // (invoked via mountPlugins() inside that same createDuneApp() call) calls
    // it again so headless-mode callers of mountDuneAdmin() (who never go
    // through createDuneApp() at all) still get publicRoutes registered. The
    // WeakSet-keyed-by-ctx dedup must make the second call inert rather than
    // double-registering.
    const plugin: DunePlugin = {
      name: "test-double-register-plugin",
      version: "1.0.0",
      hooks: {},
      publicRoutes: [
        {
          path: "/only-once",
          handler: () => new Response("first", { status: 200 }),
        },
      ],
    };
    const root = await Deno.makeTempDir({
      prefix: "dune_test_plugin_public_routes_dedup_",
    });
    try {
      await Deno.mkdir(join(root, "content", "01.home"), { recursive: true });
      await Deno.writeTextFile(
        join(root, "content", "01.home", "default.md"),
        "---\ntitle: Home\n---\n\n# Home\n",
      );
      const ctx = await bootstrap(root, { plugins: [plugin] });
      // deno-lint-ignore no-explicit-any
      const app = new App<any>();
      registerPluginPublicRoutes(app, ctx, { adminPrefix: "/admin" });
      // Second call for the same ctx — must not throw, and must not change
      // what a request to the route observes (still exactly one registration
      // worth of behavior, not two).
      registerPluginPublicRoutes(app, ctx, { adminPrefix: "/admin" });
      const handler = app.handler();
      const res = await handler(new Request("http://localhost/only-once"));
      assertEquals(res.status, 200);
      assertEquals(await res.text(), "first");
    } finally {
      for (let attempt = 0;; attempt++) {
        try {
          await Deno.remove(root, { recursive: true });
          break;
        } catch (err) {
          if (attempt >= 4) throw err;
          await new Promise((r) => setTimeout(r, 50));
        }
      }
    }
  },
);
