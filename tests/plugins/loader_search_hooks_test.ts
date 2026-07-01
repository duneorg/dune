/**
 * End-to-end test: a factory plugin loaded through the real plugin loader
 * actually fires the search hooks the way bootstrap drives them.
 *
 * The unit tests in tests/search/engine_injected_test.ts register hooks
 * directly via `hooks.on(...)`. This test instead writes a plugin module to
 * disk, loads it with `loadPlugins`, and replays the exact `onSearchRecordsCollect`
 * / `onSearchEngineCreate` sequence bootstrap uses — verifying the whole path:
 * dynamic import → factory invocation with merged config → registerPlugin
 * wiring plugin.hooks → hooks firing.
 */

import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { join } from "@std/path";
import { loadPlugins } from "../../src/plugins/loader.ts";
import { createHookRegistry } from "../../src/hooks/registry.ts";
import {
  createSearchEngine,
  type SearchEngineCreateContext,
  type SearchRecordsCollectContext,
} from "../../src/search/engine.ts";
import { FormatRegistry } from "../../src/content/formats/registry.ts";
import type { StorageAdapter } from "../../src/storage/types.ts";
import type { DuneConfig } from "../../src/config/types.ts";

function makeStorage(): StorageAdapter {
  return {
    readText: () => Promise.reject(new Error("no files")),
    exists: () => Promise.resolve(false),
    read: () => Promise.reject(new Error("not implemented")),
    write: () => Promise.reject(new Error("not implemented")),
    delete: () => Promise.reject(new Error("not implemented")),
    rename: () => Promise.reject(new Error("not implemented")),
    list: () => Promise.resolve([]),
    listRecursive: () => Promise.resolve([]),
    stat: () => Promise.reject(new Error("not implemented")),
    getJSON: () => Promise.resolve(null),
    setJSON: () => Promise.resolve(),
    deleteJSON: () => Promise.resolve(),
    watch: () => () => {},
  } as unknown as StorageAdapter;
}

function makeFormats(): FormatRegistry {
  const registry = new FormatRegistry();
  registry.register({
    extensions: [".md"],
    extractFrontmatter: () => Promise.resolve({ title: "" }),
    extractBody: () => null,
    renderToHtml: () => Promise.resolve(""),
  });
  return registry;
}

/**
 * A self-contained factory plugin written to a temp dir. It imports nothing
 * (so it resolves outside the project's import map) and reads its merged
 * config to prove config flows from site.yaml through the loader's factory call.
 */
const PLUGIN_SOURCE = `
function createTestSearchPlugin(config) {
  return {
    name: "test-search",
    version: "1.0.0",
    hooks: {
      onSearchRecordsCollect: (ctx) => {
        ctx.data.records.push({
          route: "/injected/from-plugin",
          title: config.title ?? "Injected",
          body: "body text contributed by the loaded plugin",
        });
      },
      onSearchEngineCreate: (ctx) => {
        ctx.data.engine = {
          build: () => Promise.resolve(),
          rebuild: () => Promise.resolve(),
          search: () =>
            Promise.resolve([
              { page: { route: "/x" }, score: 1, excerpt: "plugin-engine:" + (config.label ?? "default") },
            ]),
          suggest: () => Promise.resolve([]),
        };
      },
    },
  };
}
createTestSearchPlugin.pluginName = "test-search";
export default createTestSearchPlugin;
`;

Deno.test("loadPlugins: a factory plugin's search hooks fire through bootstrap's sequence", async () => {
  const tmp = await Deno.makeTempDir({ prefix: "dune-loader-search-" });
  try {
    await Deno.writeTextFile(join(tmp, "plugin.ts"), PLUGIN_SOURCE);

    const storage = makeStorage();
    const config = {
      pluginList: [
        { src: "./plugin.ts", config: { label: "meili", title: "PDF Doc" } },
      ],
      autoDiscoverPlugins: false,
      plugins: {},
      system: { debug: false },
    } as unknown as DuneConfig;

    const hooks = createHookRegistry({ config, storage });

    // 1. Load + register the plugin via the real loader (dynamic import + factory).
    await loadPlugins({ config, hooks, storage, root: tmp });

    // The loader merged the static entry config into config.plugins[name].
    assertEquals(
      (config.plugins["test-search"] as Record<string, unknown>)?.label,
      "meili",
    );

    // 2. Replay bootstrap's search-engine creation sequence.
    const recordsCtx = await hooks.fire<SearchRecordsCollectContext>(
      "onSearchRecordsCollect",
      { records: [] },
    );
    const engineCtx = await hooks.fire<SearchEngineCreateContext>(
      "onSearchEngineCreate",
      {
        engine: null,
        pages: [],
        injectedRecords: recordsCtx.records,
        storage,
        contentDir: "content",
        config,
        formats: makeFormats(),
        loadText: () => Promise.resolve(""),
        register: () => {},
        setActiveEngine: () => {},
      },
    );
    const search = engineCtx.engine ??
      createSearchEngine({
        pages: [],
        storage,
        contentDir: "content",
        formats: makeFormats(),
        injectedRecords: recordsCtx.records,
      });

    // 3a. onSearchRecordsCollect ran, and the factory saw its merged config.
    assertEquals(recordsCtx.records.length, 1);
    assertEquals(recordsCtx.records[0].route, "/injected/from-plugin");
    assertEquals(recordsCtx.records[0].title, "PDF Doc");

    // 3b. onSearchEngineCreate replaced the built-in engine with the plugin's.
    assertExists(engineCtx.engine);
    const hits = await search.search("anything");
    assertEquals(hits[0].excerpt, "plugin-engine:meili");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("loadPlugins: no search hooks registered → engine falls back to built-in", async () => {
  const tmp = await Deno.makeTempDir({ prefix: "dune-loader-nosearch-" });
  try {
    // A plugin that registers an unrelated hook only.
    await Deno.writeTextFile(
      join(tmp, "plugin.ts"),
      `export default { name: "noop", version: "1.0.0", hooks: { onRebuild: () => {} } };\n`,
    );

    const storage = makeStorage();
    const config = {
      pluginList: [{ src: "./plugin.ts" }],
      autoDiscoverPlugins: false,
      plugins: {},
      system: { debug: false },
    } as unknown as DuneConfig;

    const hooks = createHookRegistry({ config, storage });
    await loadPlugins({ config, hooks, storage, root: tmp });

    const recordsCtx = await hooks.fire<SearchRecordsCollectContext>(
      "onSearchRecordsCollect",
      { records: [] },
    );
    const engineCtx = await hooks.fire<SearchEngineCreateContext>(
      "onSearchEngineCreate",
      {
        engine: null,
        pages: [],
        injectedRecords: recordsCtx.records,
        storage,
        contentDir: "content",
        config,
        formats: makeFormats(),
        loadText: () => Promise.resolve(""),
        register: () => {},
        setActiveEngine: () => {},
      },
    );

    assertEquals(recordsCtx.records.length, 0);
    assertEquals(engineCtx.engine, null);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});
