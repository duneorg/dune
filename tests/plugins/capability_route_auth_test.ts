/**
 * Replaces the old `mountEarly` ordering test. The bug it guarded: a plugin's
 * own route, registered before the admin plugin's `mount()`, could never see
 * state the admin's middleware set, because Fresh fixes a route's middleware
 * chain when the route is registered. `mountEarly` worked around that by
 * mounting admin middleware first.
 *
 * Now a route that needs to know who the admin is asks the `editor.session`
 * capability at request time, so it works whatever the mount order and without
 * naming the admin plugin or relying on shared request state.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { App } from "fresh";
import { bootstrap } from "../../src/runtime/bootstrap.ts";
import { mountPlugins } from "../../src/plugins/loader.ts";
import type { DunePlugin } from "../../src/hooks/types.ts";

Deno.test(
  "a plugin mounted before the editor.session provider still identifies the admin in its own route",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    const root = await Deno.makeTempDir({ prefix: "dune_test_capability_route_auth_" });
    try {
      await Deno.mkdir(join(root, "content", "01.home"), { recursive: true });
      await Deno.writeTextFile(join(root, "content", "01.home", "default.md"), "---\ntitle: Home\n---\n\n# Home\n");

      // Registered (and mounted) first, like a site-configured plugin.
      const userPlugin: DunePlugin = {
        name: "test-user-plugin",
        version: "1.0.0",
        hooks: {},
        mount({ app, capabilities }) {
          app.get("/who", async (fc) => {
            const auth = capabilities.get("editor.session");
            const result = auth ? await auth.authenticate(fc.req) : null;
            return new Response(result?.authenticated ? result.user?.username ?? "?" : "anonymous");
          });
        },
      };

      // Registered after it, like the built-in admin plugin.
      const authProvider: DunePlugin = {
        name: "test-auth-provider",
        version: "1.0.0",
        hooks: {},
        setup(api) {
          api.capabilities.provide("editor.session", () => ({
            authenticate(req) {
              const name = req.headers.get("x-test-admin");
              return Promise.resolve(
                name ? { authenticated: true, user: { id: name, username: name } } : { authenticated: false },
              );
            },
          }));
        },
      };

      const ctx = await bootstrap(root, {
        plugins: [userPlugin, authProvider],
        // deno-lint-ignore no-explicit-any
        
      });
      // deno-lint-ignore no-explicit-any
      const app = new App<any>();
      await mountPlugins(app, ctx);
      const handler = app.handler();

      const signedIn = await handler(new Request("http://localhost:8000/who", { headers: { "x-test-admin": "alice" } }));
      assertEquals(await signedIn.text(), "alice");
      const anonymous = await handler(new Request("http://localhost:8000/who"));
      assertEquals(await anonymous.text(), "anonymous");
    } finally {
      await removeWithRetry(root);
    }
  },
);

Deno.test(
  "without an editor.session provider a plugin route sees every visitor as anonymous",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    const root = await Deno.makeTempDir({ prefix: "dune_test_capability_route_auth_none_" });
    try {
      await Deno.mkdir(join(root, "content", "01.home"), { recursive: true });
      await Deno.writeTextFile(join(root, "content", "01.home", "default.md"), "---\ntitle: Home\n---\n\n# Home\n");
      const userPlugin: DunePlugin = {
        name: "test-user-plugin",
        version: "1.0.0",
        hooks: {},
        mount({ app, capabilities }) {
          app.get("/who", (fc) => {
            void fc;
            return new Response(capabilities.get("editor.session") ? "has-provider" : "no-provider");
          });
        },
      };
      const ctx = await bootstrap(root, {
        plugins: [userPlugin],
        // deno-lint-ignore no-explicit-any
        
      });
      // deno-lint-ignore no-explicit-any
      const app = new App<any>();
      await mountPlugins(app, ctx);
      const res = await app.handler()(new Request("http://localhost:8000/who"));
      assertEquals(await res.text(), "no-provider");
    } finally {
      await removeWithRetry(root);
    }
  },
);

// bootstrap() can still hold a file handle for a moment on teardown.
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
