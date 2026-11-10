import { assertEquals, assertExists, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { App } from "fresh";
import { bootstrap } from "../../src/runtime/bootstrap.ts";
import { mountPlugins, resolveCapabilities } from "../../src/plugins/loader.ts";
import { createHookRegistry } from "../../src/hooks/registry.ts";
import { DEFAULT_CONFIG } from "../../src/config/defaults.ts";
import type { DuneConfig } from "../../src/config/types.ts";
import type { DunePlugin } from "../../src/hooks/types.ts";
import { MemoryStorageAdapter } from "../../src/storage/memory.ts";
import {
  adminPrefixOf,
  type CapabilityContext,
  type CapabilityKey,
  capabilityKey,
  createCapabilityRegistry,
  describeConflict,
  invalidAdminPrefix,
  type RequestAuthenticator,
} from "../../src/plugin-api/capabilities.ts";

// The contract names no extension point of a plugin's own. A plugin exports
// typed keys next to its types, prefixed with its name; these two stand in for
// `admin.pages` / `admin.routes` of the admin plugin.
const TEST_PAGES: CapabilityKey<{ path: string; label: string; permission: string; handler: () => Response }> =
  capabilityKey("test.pages");
const TEST_ROUTES: CapabilityKey<
  { method: "GET" | "POST" | "DELETE"; path: string; permission: string; handler: () => Response }
> = capabilityKey("test.routes");

const auth = (name: string): RequestAuthenticator => ({
  authenticate: () => Promise.resolve({ authenticated: true, user: { id: name, username: name } }),
});
// The factories under test never touch the context.
const ctx = {} as CapabilityContext;

Deno.test("capabilities: a slot is empty until resolved, then active", async () => {
  const reg = createCapabilityRegistry();
  reg.registrar("admin").provide("editor.session", () => auth("a"));
  assertEquals(reg.reader.get("editor.session"), undefined, "not resolved yet");
  assertEquals(reg.reader.providers()[0].status, "unresolved");
  await reg.resolve(ctx);
  assertExists(reg.reader.get("editor.session"));
  assertEquals(reg.reader.providers(), [{ name: "editor.session", kind: "slot", provider: "admin", status: "active" }]);
});

Deno.test("capabilities: an unprovided slot is simply absent", async () => {
  const reg = createCapabilityRegistry();
  await reg.resolve(ctx);
  assertEquals(reg.reader.get("editor.inline"), undefined);
  assertEquals(reg.reader.list(TEST_PAGES), []);
  assertEquals(reg.reader.providers(), []);
});

Deno.test("capabilities: a later provider replaces an earlier one (any slot but the exclusive ones)", async () => {
  const reg = createCapabilityRegistry();
  const executor = (name: string) => ({ execute: () => Promise.resolve(void name) });
  reg.registrar("first").provide("scheduler.executor", () => executor("first"));
  reg.registrar("second").provide("scheduler.executor", () => executor("second"));
  await reg.resolve(ctx);
  assertEquals(reg.reader.providers().map((p) => p.provider), ["second"]);
  assertEquals(reg.conflicts(), []);
});

Deno.test("capabilities: two plugins providing editor.session is a conflict, not a replacement", async () => {
  const reg = createCapabilityRegistry();
  reg.registrar("first").provide("editor.session", () => auth("first"));
  reg.registrar("second").provide("editor.session", () => auth("second"));
  reg.registrar("third").provide("editor.session", () => auth("third"));
  assertEquals(reg.conflicts(), [{ capability: "editor.session", providers: ["first", "second", "third"] }]);
  assertEquals(reg.reader.providers().map((p) => p.provider), ["first"], "the first provider is kept");
  await reg.resolve(ctx);
  const who = await reg.reader.get("editor.session")!.authenticate(new Request("http://x/"));
  assertEquals(who.user?.id, "first");
  assertStringIncludes(
    describeConflict(reg.conflicts()[0]),
    '"first", "second", "third"',
  );
});

Deno.test("capabilities: one plugin providing editor.session twice replaces itself with a warning", () => {
  const reg = createCapabilityRegistry();
  const r = reg.registrar("only");
  r.provide("editor.session", () => auth("a"));
  r.provide("editor.session", () => auth("b"));
  assertEquals(reg.conflicts(), []);
});

Deno.test("capabilities: factories run once each, in registration order, and may be async", async () => {
  const reg = createCapabilityRegistry();
  const order: string[] = [];
  reg.registrar("a").provide("editor.session", async () => {
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
  reg.registrar("broken").provide("editor.session", () => {
    throw new Error("boom");
  });
  reg.registrar("fine").provide("scheduler.executor", () => ({ execute: () => Promise.resolve() }));
  await reg.resolve(ctx);
  assertEquals(reg.reader.get("editor.session"), undefined);
  assertExists(reg.reader.get("scheduler.executor"));
  const status = Object.fromEntries(reg.reader.providers().map((p) => [p.name, p.status]));
  assertEquals(status, { "editor.session": "failed", "scheduler.executor": "active" });
});

Deno.test("capabilities: a factory returning undefined declines the slot", async () => {
  const reg = createCapabilityRegistry();
  reg.registrar("p").provide("editor.inline", () => undefined);
  await reg.resolve(ctx);
  assertEquals(reg.reader.get("editor.inline"), undefined);
  assertEquals(reg.reader.providers()[0].status, "declined");
});

Deno.test("capabilities: contributions append in registration order and name their provider", () => {
  const reg = createCapabilityRegistry();
  const page = (path: string) => ({ path, label: path, permission: "pages.read", handler: () => new Response("") });
  reg.registrar("x").contribute(TEST_PAGES, page("/x"));
  reg.registrar("y").contribute(TEST_PAGES, page("/y"));
  assertEquals(reg.reader.list(TEST_PAGES).map((p) => p.path), ["/x", "/y"]);
  assertEquals(reg.reader.providers().map((p) => `${p.name}:${p.provider}`), ["test.pages:x", "test.pages:y"]);
});

Deno.test("capabilities: test.routes contributions keep their method and order", () => {
  const reg = createCapabilityRegistry();
  const route = (method: "GET" | "POST" | "DELETE", path: string) => ({
    method,
    path,
    permission: "config.update",
    handler: () => new Response(""),
  });
  reg.registrar("a").contribute(TEST_ROUTES, route("POST", "/api/a/save"));
  reg.registrar("b").contribute(TEST_ROUTES, route("DELETE", "/api/b/item"));
  assertEquals(reg.reader.list(TEST_ROUTES).map((r) => `${r.method} ${r.path}`), [
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
      api.capabilities.provide("editor.session", () => auth("mine"));
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
          api.capabilities.provide("editor.session", () => {
            factoryRanBeforeMount = true;
            return auth("provided");
          });
          api.capabilities.contribute(TEST_PAGES, { path: "/p", label: "P", permission: "pages.read", handler: () => new Response("") });
        },
      };
      const consumer: DunePlugin = {
        name: "test-consumer",
        version: "1.0.0",
        hooks: {},
        async mount({ capabilities }) {
          const a = capabilities.get("editor.session");
          seen = a ? (await a.authenticate(new Request("http://x/"))).user?.id : undefined;
          if (capabilities.list(TEST_PAGES).length !== 1) seen = "contribution-missing";
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

Deno.test("adminPrefixOf: the provided prefix, or null when there is none", async () => {
  const reg = createCapabilityRegistry();
  assertEquals(adminPrefixOf(reg.reader), null, "nothing provided");
  reg.registrar("admin").provide("admin.prefix", () => ({ prefix: "/cms" }));
  assertEquals(adminPrefixOf(reg.reader), null, "not resolved yet");
  await reg.resolve(ctx);
  assertEquals(adminPrefixOf(reg.reader), "/cms");
});

Deno.test("adminPrefixOf: refuses a prefix that is not a usable path prefix", async () => {
  for (const bad of ["", "/", "admin", "/admin/"]) {
    const reg = createCapabilityRegistry();
    reg.registrar("admin").provide("admin.prefix", () => ({ prefix: bad }));
    await reg.resolve(ctx);
    assertEquals(adminPrefixOf(reg.reader), null, `"${bad}" must not become the admin prefix`);
  }
});

Deno.test(
  "resolveCapabilities: resolves slots once, before mount, and can be called again",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    const root = await Deno.makeTempDir({ prefix: "dune_test_resolve_caps_" });
    try {
      await Deno.mkdir(join(root, "content", "01.home"), { recursive: true });
      await Deno.writeTextFile(join(root, "content", "01.home", "default.md"), "---\ntitle: Home\n---\n");
      let runs = 0;
      const plugin: DunePlugin = {
        name: "test-admin",
        version: "1.0.0",
        hooks: {},
        setup(api) {
          api.capabilities.provide("admin.prefix", () => {
            runs++;
            return { prefix: "/cms" };
          });
        },
      };
      const boot = await bootstrap(root, { plugins: [plugin] });
      await resolveCapabilities(boot);
      assertEquals(adminPrefixOf(boot.capabilities), "/cms");
      await resolveCapabilities(boot);
      // deno-lint-ignore no-explicit-any
      await mountPlugins(new App<any>(), boot);
      assertEquals(runs, 1, "the factory runs once however many times slots are resolved");
    } finally {
      await removeWithRetry(root);
    }
  },
);

Deno.test(
  "mountPlugins: two plugins providing editor.session stop the boot, naming both",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    const root = await Deno.makeTempDir({ prefix: "dune_test_capabilities_conflict_" });
    try {
      await Deno.mkdir(join(root, "content", "01.home"), { recursive: true });
      await Deno.writeTextFile(join(root, "content", "01.home", "default.md"), "---\ntitle: Home\n---\n\n# Home\n");
      let mounted = false;
      const plugin = (name: string): DunePlugin => ({
        name,
        version: "1.0.0",
        hooks: {},
        setup: (api) => api.capabilities.provide("editor.session", () => auth(name)),
        mount: () => {
          mounted = true;
        },
      });
      const ctx = await bootstrap(root, { plugins: [plugin("login-a"), plugin("login-b")] });
      const err = await assertRejects(
        // deno-lint-ignore no-explicit-any
        () => mountPlugins(new App<any>(), ctx),
        Error,
        "editor.session",
      );
      assertStringIncludes(err.message, '"login-a", "login-b"');
      assertEquals(mounted, false, "no plugin is mounted once the boot is refused");
    } finally {
      await removeWithRetry(root);
    }
  },
);

Deno.test("capabilities: two plugins providing admin.prefix is a conflict (one admin per site)", () => {
  const reg = createCapabilityRegistry();
  reg.registrar("admin-a").provide("admin.prefix", () => ({ prefix: "/admin" }));
  reg.registrar("admin-b").provide("admin.prefix", () => ({ prefix: "/studio" }));
  assertEquals(reg.conflicts(), [{ capability: "admin.prefix", providers: ["admin-a", "admin-b"] }]);
});

Deno.test("capabilities: invalidAdminPrefix names an unusable prefix and accepts a usable one", async () => {
  for (const [prefix, bad] of [["/admin", false], ["/a/b", false], ["admin", true], ["/", true], ["/admin/", true], ["", true]] as const) {
    const reg = createCapabilityRegistry();
    reg.registrar("a").provide("admin.prefix", () => ({ prefix }));
    await reg.resolve(ctx);
    assertEquals(invalidAdminPrefix(reg.reader) !== null, bad, JSON.stringify(prefix));
  }
  assertEquals(invalidAdminPrefix(createCapabilityRegistry().reader), null, "no provider is not an error");
});

Deno.test(
  "mountPlugins: an unusable admin.prefix stops the boot instead of meaning \"no admin\"",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    const root = await Deno.makeTempDir({ prefix: "dune_test_capabilities_prefix_" });
    try {
      await Deno.mkdir(join(root, "content", "01.home"), { recursive: true });
      await Deno.writeTextFile(join(root, "content", "01.home", "default.md"), "---\ntitle: Home\n---\n\n# Home\n");
      const plugin: DunePlugin = {
        name: "odd-admin",
        version: "1.0.0",
        hooks: {},
        setup: (api) => api.capabilities.provide("admin.prefix", () => ({ prefix: "admin/" })),
      };
      const ctx = await bootstrap(root, { plugins: [plugin] });
      const err = await assertRejects(
        // deno-lint-ignore no-explicit-any
        () => mountPlugins(new App<any>(), ctx),
        Error,
        "admin.prefix",
      );
      assertStringIncludes(err.message, '"admin/"');
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

Deno.test("capabilities: a plugin's own slot is provided and read through its key; the same name is the same capability", async () => {
  const EDITOR: CapabilityKey<{ label: string }> = capabilityKey("test.editor");
  const reg = createCapabilityRegistry();
  reg.registrar("alt").provide(EDITOR, () => ({ label: "alt" }));
  assertEquals(reg.reader.get(EDITOR), undefined, "not resolved yet");
  await reg.resolve(ctx);
  assertEquals(reg.reader.get(EDITOR)?.label, "alt");
  // Another plugin recreates the key from its documented name instead of importing it.
  assertEquals(reg.reader.get(capabilityKey<{ label: string }>("test.editor"))?.label, "alt");
  assertEquals(reg.reader.providers(), [{ name: "test.editor", kind: "slot", provider: "alt", status: "active" }]);
});
