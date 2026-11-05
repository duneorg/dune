import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { App } from "fresh";
import { bootstrap } from "../../src/runtime/bootstrap.ts";
import { mountPlugins } from "../../src/plugins/loader.ts";
import { createHookRegistry } from "../../src/hooks/registry.ts";
import { DEFAULT_CONFIG } from "../../src/config/defaults.ts";
import type { DuneConfig } from "../../src/config/types.ts";
import type { DunePlugin } from "../../src/hooks/types.ts";
import { MemoryStorageAdapter } from "../../src/storage/memory.ts";
import {
  type CapabilityContext,
  createCapabilityRegistry,
  type RequestAuthenticator,
} from "../../src/plugin-api/capabilities.ts";

const auth = (name: string): RequestAuthenticator => ({
  authenticate: () => Promise.resolve({ authenticated: true, user: { id: name, username: name } }),
});
// The factories under test never touch the context.
const ctx = {} as CapabilityContext;

Deno.test("capabilities: a slot is empty until resolved, then active", async () => {
  const reg = createCapabilityRegistry();
  reg.registrar("admin").provide("auth.session", () => auth("a"));
  assertEquals(reg.reader.get("auth.session"), undefined, "not resolved yet");
  assertEquals(reg.reader.providers()[0].status, "unresolved");
  await reg.resolve(ctx);
  assertExists(reg.reader.get("auth.session"));
  assertEquals(reg.reader.providers(), [{ name: "auth.session", kind: "slot", provider: "admin", status: "active" }]);
});

Deno.test("capabilities: an unprovided slot is simply absent", async () => {
  const reg = createCapabilityRegistry();
  await reg.resolve(ctx);
  assertEquals(reg.reader.get("inline-edit"), undefined);
  assertEquals(reg.reader.list("bar.actions"), []);
  assertEquals(reg.reader.providers(), []);
});

Deno.test("capabilities: a later provider replaces an earlier one", async () => {
  const reg = createCapabilityRegistry();
  reg.registrar("first").provide("auth.session", () => auth("first"));
  reg.registrar("second").provide("auth.session", () => auth("second"));
  await reg.resolve(ctx);
  const who = await reg.reader.get("auth.session")!.authenticate(new Request("http://x/"));
  assertEquals(who.user?.id, "second");
  assertEquals(reg.reader.providers().map((p) => p.provider), ["second"]);
});

Deno.test("capabilities: factories run once each, in registration order, and may be async", async () => {
  const reg = createCapabilityRegistry();
  const order: string[] = [];
  reg.registrar("a").provide("auth.session", async () => {
    await new Promise((r) => setTimeout(r, 5));
    order.push("auth");
    return auth("a");
  });
  reg.registrar("b").provide("scheduler.executor", () => {
    order.push("scheduler");
    return { execute: () => Promise.resolve() };
  });
  await reg.resolve(ctx);
  await reg.resolve(ctx); // a second pass must not re-run resolved factories
  assertEquals(order, ["auth", "scheduler"]);
});

Deno.test("capabilities: a throwing factory leaves its slot empty and does not stop the others", async () => {
  const reg = createCapabilityRegistry();
  reg.registrar("broken").provide("auth.session", () => {
    throw new Error("boom");
  });
  reg.registrar("fine").provide("scheduler.executor", () => ({ execute: () => Promise.resolve() }));
  await reg.resolve(ctx);
  assertEquals(reg.reader.get("auth.session"), undefined);
  assertExists(reg.reader.get("scheduler.executor"));
  const status = Object.fromEntries(reg.reader.providers().map((p) => [p.name, p.status]));
  assertEquals(status, { "auth.session": "failed", "scheduler.executor": "active" });
});

Deno.test("capabilities: a factory returning undefined declines the slot", async () => {
  const reg = createCapabilityRegistry();
  reg.registrar("p").provide("inline-edit", () => undefined);
  await reg.resolve(ctx);
  assertEquals(reg.reader.get("inline-edit"), undefined);
  assertEquals(reg.reader.providers()[0].status, "declined");
});

Deno.test("capabilities: contributions append in registration order and name their provider", () => {
  const reg = createCapabilityRegistry();
  const page = (path: string) => ({ path, label: path, handler: () => new Response("") });
  reg.registrar("x").contribute("admin.pages", page("/x"));
  reg.registrar("y").contribute("admin.pages", page("/y"));
  assertEquals(reg.reader.list("admin.pages").map((p) => p.path), ["/x", "/y"]);
  assertEquals(reg.reader.providers().map((p) => `${p.name}:${p.provider}`), ["admin.pages:x", "admin.pages:y"]);
});

Deno.test("capabilities: admin.routes contributions keep their method and order", () => {
  const reg = createCapabilityRegistry();
  const route = (method: "GET" | "POST" | "DELETE", path: string) => ({
    method,
    path,
    permission: "config.update",
    handler: () => new Response(""),
  });
  reg.registrar("a").contribute("admin.routes", route("POST", "/api/a/save"));
  reg.registrar("b").contribute("admin.routes", route("DELETE", "/api/b/item"));
  assertEquals(reg.reader.list("admin.routes").map((r) => `${r.method} ${r.path}`), [
    "POST /api/a/save",
    "DELETE /api/b/item",
  ]);
  assertEquals(reg.reader.providers().map((p) => p.provider), ["a", "b"]);
});

Deno.test("capabilities: the hook registry attributes a plugin's declarations to its name", async () => {
  const capabilities = createCapabilityRegistry();
  const config = structuredClone(DEFAULT_CONFIG) as unknown as DuneConfig;
  const hooks = createHookRegistry({ config, storage: new MemoryStorageAdapter(), capabilities });
  hooks.registerPlugin({
    name: "my-auth",
    version: "1.0.0",
    hooks: {},
    setup: (api) => {
      api.capabilities.provide("auth.session", () => auth("mine"));
    },
  });
  await hooks.whenSetupComplete();
  assertEquals(capabilities.reader.providers()[0].provider, "my-auth");
});

Deno.test(
  "mountPlugins: slots are resolved before mount() and readable there",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    const root = await Deno.makeTempDir({ prefix: "dune_test_capabilities_" });
    try {
      await Deno.mkdir(join(root, "content", "01.home"), { recursive: true });
      await Deno.writeTextFile(join(root, "content", "01.home", "default.md"), "---\ntitle: Home\n---\n\n# Home\n");

      let seen: string | undefined = "not-run";
      let factoryRanBeforeMount = false;
      const provider: DunePlugin = {
        name: "test-provider",
        version: "1.0.0",
        hooks: {},
        setup: (api) => {
          api.capabilities.provide("auth.session", () => {
            factoryRanBeforeMount = true;
            return auth("provided");
          });
          api.capabilities.contribute("admin.pages", { path: "/p", label: "P", handler: () => new Response("") });
        },
      };
      const consumer: DunePlugin = {
        name: "test-consumer",
        version: "1.0.0",
        hooks: {},
        async mount({ capabilities }) {
          const a = capabilities.get("auth.session");
          seen = a ? (await a.authenticate(new Request("http://x/"))).user?.id : undefined;
          if (capabilities.list("admin.pages").length !== 1) seen = "contribution-missing";
        },
      };

      const ctx = await bootstrap(root, { plugins: [provider, consumer] });
      // deno-lint-ignore no-explicit-any
      await mountPlugins(new App<any>(), ctx);

      assertEquals(factoryRanBeforeMount, true);
      assertEquals(seen, "provided");
      assertEquals(ctx.capabilities.providers().some((p) => p.provider === "test-provider"), true);
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
