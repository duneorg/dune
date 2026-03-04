import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createHookRegistry } from "../../src/hooks/registry.ts";
import type { DuneConfig } from "../../src/config/types.ts";
import type { StorageAdapter } from "../../src/storage/types.ts";

// Minimal config and storage stubs
const stubConfig = {
  site: { title: "Test", description: "", url: "http://localhost", author: { name: "" }, metadata: {}, taxonomies: [], routes: {}, redirects: {} },
  system: { content: { dir: "content", markdown: { extra: true, auto_links: true, auto_url_links: true } }, cache: { enabled: false, driver: "memory", lifetime: 0, check: "none" }, images: { default_quality: 80, cache_dir: "", allowed_sizes: [] }, languages: { supported: ["en"], default: "en", include_default_in_url: false }, debug: false, timezone: "UTC" },
  theme: { name: "default", custom: {} },
  plugins: {},
  pluginList: [],
} as unknown as DuneConfig;

const stubStorage = {} as StorageAdapter;

Deno.test("hooks.fire: no handlers → returns data unchanged", async () => {
  const registry = createHookRegistry({ config: stubConfig, storage: stubStorage });
  const result = await registry.fire("onConfigLoaded", { test: true });
  assertEquals(result, { test: true });
});

Deno.test("hooks.on + fire: handler receives and can mutate data", async () => {
  const registry = createHookRegistry({ config: stubConfig, storage: stubStorage });
  registry.on("onConfigLoaded", (ctx) => {
    ctx.setData({ ...(ctx.data as object), added: true });
  });
  const result = await registry.fire("onConfigLoaded", { original: true }) as Record<string, boolean>;
  assertEquals(result.original, true);
  assertEquals(result.added, true);
});

Deno.test("hooks.on + fire: multiple handlers called in order", async () => {
  const registry = createHookRegistry({ config: stubConfig, storage: stubStorage });
  const calls: number[] = [];
  registry.on("onContentIndexReady", (_ctx) => { calls.push(1); });
  registry.on("onContentIndexReady", (_ctx) => { calls.push(2); });
  registry.on("onContentIndexReady", (_ctx) => { calls.push(3); });
  await registry.fire("onContentIndexReady", []);
  assertEquals(calls, [1, 2, 3]);
});

Deno.test("hooks.fire: stopPropagation prevents later handlers", async () => {
  const registry = createHookRegistry({ config: stubConfig, storage: stubStorage });
  const calls: number[] = [];
  registry.on("onConfigLoaded", (ctx) => { calls.push(1); ctx.stopPropagation(); });
  registry.on("onConfigLoaded", (_ctx) => { calls.push(2); });
  await registry.fire("onConfigLoaded", {});
  assertEquals(calls, [1]);
});

Deno.test("hooks.fire: data threading — each handler sees previous handler's data", async () => {
  const registry = createHookRegistry({ config: stubConfig, storage: stubStorage });
  registry.on("onConfigLoaded", (ctx) => { ctx.setData((ctx.data as number) + 1); });
  registry.on("onConfigLoaded", (ctx) => { ctx.setData((ctx.data as number) * 10); });
  const result = await registry.fire("onConfigLoaded", 5 as unknown as DuneConfig);
  assertEquals(result as unknown, 60); // (5 + 1) * 10
});

Deno.test("hooks.off: removes a specific handler", async () => {
  const registry = createHookRegistry({ config: stubConfig, storage: stubStorage });
  const calls: string[] = [];
  const h1 = () => { calls.push("h1"); };
  const h2 = () => { calls.push("h2"); };
  registry.on("onStorageReady", h1);
  registry.on("onStorageReady", h2);
  registry.off("onStorageReady", h1);
  await registry.fire("onStorageReady", {} as StorageAdapter);
  assertEquals(calls, ["h2"]);
});

Deno.test("hooks.off: no-op when handler not registered", () => {
  const registry = createHookRegistry({ config: stubConfig, storage: stubStorage });
  // Should not throw
  registry.off("onConfigLoaded", () => {});
});

Deno.test("hooks.on: handlers on different events don't interfere", async () => {
  const registry = createHookRegistry({ config: stubConfig, storage: stubStorage });
  const calls: string[] = [];
  registry.on("onConfigLoaded", () => { calls.push("config"); });
  registry.on("onStorageReady", () => { calls.push("storage"); });
  await registry.fire("onConfigLoaded", {} as DuneConfig);
  assertEquals(calls, ["config"]);
});

Deno.test("hooks.ctx: handler receives event name, config, and storage", async () => {
  const registry = createHookRegistry({ config: stubConfig, storage: stubStorage });
  let capturedEvent: string | undefined;
  let capturedConfig: DuneConfig | undefined;
  registry.on("onConfigLoaded", (ctx) => {
    capturedEvent = ctx.event;
    capturedConfig = ctx.config;
  });
  await registry.fire("onConfigLoaded", {} as DuneConfig);
  assertEquals(capturedEvent, "onConfigLoaded");
  assertExists(capturedConfig);
});

Deno.test("hooks.registerPlugin: registers plugin and its hooks", async () => {
  const registry = createHookRegistry({ config: stubConfig, storage: stubStorage });
  const calls: string[] = [];
  registry.registerPlugin({
    name: "test-plugin",
    version: "1.0.0",
    hooks: {
      onConfigLoaded: () => { calls.push("plugin-hook"); },
    },
  });
  await registry.fire("onConfigLoaded", {} as DuneConfig);
  assertEquals(calls, ["plugin-hook"]);
});

Deno.test("hooks.registerPlugin: plugin appears in plugins() list", () => {
  const registry = createHookRegistry({ config: stubConfig, storage: stubStorage });
  registry.registerPlugin({ name: "p1", version: "1.0.0", hooks: {} });
  registry.registerPlugin({ name: "p2", version: "2.0.0", hooks: {} });
  const plugins = registry.plugins();
  assertEquals(plugins.length, 2);
  assertEquals(plugins[0].name, "p1");
  assertEquals(plugins[1].name, "p2");
});

Deno.test("hooks.plugins: returns copy — mutating result doesn't affect registry", () => {
  const registry = createHookRegistry({ config: stubConfig, storage: stubStorage });
  registry.registerPlugin({ name: "p1", version: "1.0.0", hooks: {} });
  const first = registry.plugins();
  first.push({ name: "injected", version: "0.0.0", hooks: {} });
  assertEquals(registry.plugins().length, 1);
});

Deno.test("hooks.fire: async handler is awaited", async () => {
  const registry = createHookRegistry({ config: stubConfig, storage: stubStorage });
  let done = false;
  registry.on("onConfigLoaded", async (ctx) => {
    await new Promise((r) => setTimeout(r, 5));
    ctx.setData({ async: true });
    done = true;
  });
  const result = await registry.fire("onConfigLoaded", {} as DuneConfig) as unknown as { async: boolean };
  assertEquals(done, true);
  assertEquals(result.async, true);
});

Deno.test("hooks.fire: stopPropagation + setData — stopped data is still returned", async () => {
  const registry = createHookRegistry({ config: stubConfig, storage: stubStorage });
  registry.on("onConfigLoaded", (ctx) => {
    ctx.setData({ stopped: true } as unknown as DuneConfig);
    ctx.stopPropagation();
  });
  registry.on("onConfigLoaded", (ctx) => {
    ctx.setData({ stopped: false } as unknown as DuneConfig);
  });
  const result = await registry.fire("onConfigLoaded", {} as DuneConfig) as unknown as { stopped: boolean };
  assertEquals(result.stopped, true);
});
