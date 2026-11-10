import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { App, type FreshContext } from "fresh";
import { bootstrap } from "../../src/runtime/bootstrap.ts";
import { mountPlugins } from "../../src/plugins/loader.ts";
import type { PluginApp, PluginRouteContext, PluginRouteHandler } from "../../src/plugin-api/app.ts";
import type { PublicRouteRegistration } from "../../src/hooks/types.ts";
import type { DunePlugin } from "../../src/hooks/types.ts";

// ── Types: Fresh's App and FreshContext satisfy the contract ────────────────

Deno.test("the contract's route types are satisfied by Fresh's own, both ways", () => {
  // deno-lint-ignore no-explicit-any
  const app: PluginApp = new App<any>();
  assertEquals(typeof app.get, "function");

  const asContext = (fc: FreshContext<{ n: number }>): PluginRouteContext<{ n: number }> => fc;
  assertEquals(typeof asContext, "function");

  // A handler written against the contract runs inside Fresh.
  const handler: PluginRouteHandler = (ctx) => new Response(ctx.url.pathname);
  // deno-lint-ignore no-explicit-any
  new App<any>().get("/x", handler);

  // A route registration takes a handler written against a full Fresh context
  // (it declares `handler` as a method, so the parameter is checked bivariantly).
  const pub: PublicRouteRegistration = { path: "/pub", handler: (ctx: FreshContext<unknown>) => new Response(ctx.req.method) };
  assertEquals(pub.path, "/pub");
});

// ── Runtime: a plugin written only against PluginApp works ──────────────────

Deno.test(
  "mount(): middleware, params, url and per-request state work through PluginApp alone",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    const root = await Deno.makeTempDir({ prefix: "dune_test_plugin_app_" });
    try {
      await Deno.mkdir(join(root, "content", "01.home"), { recursive: true });
      await Deno.writeTextFile(join(root, "content", "01.home", "default.md"), "---\ntitle: Home\n---\n\n# Home\n");

      const plugin: DunePlugin = {
        name: "plugin-app-probe",
        version: "1.0.0",
        hooks: {},
        mount({ app }) {
          app.use(async (ctx) => {
            ctx.state = { ...ctx.state, seen: "middleware" };
            return await ctx.next();
          });
          app.get("/probe/:id", (ctx) =>
            Response.json({ id: ctx.params.id, path: ctx.url.pathname, state: ctx.state.seen, method: ctx.req.method }));
          app.post("/probe/:id", (ctx) => new Response(`posted ${ctx.params.id}`));
        },
      };
      const boot = await bootstrap(root, { plugins: [plugin] });
      // deno-lint-ignore no-explicit-any
      const app = new App<any>();
      await mountPlugins(app, boot);
      const handler = app.handler();

      const got = await handler(new Request("http://localhost/probe/7"));
      assertEquals(await got.json(), { id: "7", path: "/probe/7", state: "middleware", method: "GET" });
      const posted = await handler(new Request("http://localhost/probe/9", { method: "POST" }));
      assertEquals(await posted.text(), "posted 9");
    } finally {
      await Deno.remove(root, { recursive: true }).catch(() => {});
    }
  },
);
