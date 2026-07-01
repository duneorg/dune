/**
 * Tests for plugin-injected search records (the `injectedRecords` option and
 * the `onSearchRecordsCollect` / `onSearchEngineCreate` hook contract).
 *
 * Injected records are indexed from memory (no file read) and carry their own
 * result route — the mechanism behind PDF text indexing.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createSearchEngine,
  type InjectedSearchRecord,
  type SearchEngine,
  type SearchEngineCreateContext,
  type SearchRecordsCollectContext,
} from "../../src/search/engine.ts";
import { createHookRegistry } from "../../src/hooks/registry.ts";
import { FormatRegistry } from "../../src/content/formats/registry.ts";
import type { PageIndex } from "../../src/content/types.ts";
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

function makePage(sourcePath: string, title: string): PageIndex {
  return {
    sourcePath,
    route: "/" + sourcePath.replace(/\.md$/, ""),
    language: "en",
    format: "md",
    template: "default",
    title,
    navTitle: title,
    date: null,
    published: true,
    status: "published",
    visible: true,
    routable: true,
    isModule: false,
    order: 1,
    depth: 1,
    parentPath: null,
    taxonomy: {},
    mtime: 0,
    hash: "",
  };
}

const PDF_RECORD: InjectedSearchRecord = {
  route: "/pdf/issue-1.pdf",
  title: "Quarterly Report",
  body: "annual revenue figures and projections for the fiscal year",
  template: "pdf",
};

Deno.test("injectedRecords: appears in search results with its own route", async () => {
  const engine = createSearchEngine({
    pages: [],
    storage: makeStorage(),
    contentDir: "content",
    formats: makeFormats(),
    injectedRecords: [PDF_RECORD],
  });

  await engine.build();
  const results = await engine.search("revenue");

  assertEquals(results.length, 1);
  assertEquals(results[0].page.route, "/pdf/issue-1.pdf");
  assertEquals(results[0].page.title, "Quarterly Report");
  assertEquals(results[0].page.template, "pdf");
});

Deno.test("injectedRecords: indexed extra fields are searchable", async () => {
  const engine = createSearchEngine({
    pages: [],
    storage: makeStorage(),
    contentDir: "content",
    formats: makeFormats(),
    injectedRecords: [{
      route: "/pdf/manual.pdf",
      title: "Manual",
      body: "installation steps",
      fields: { author: "Ada Lovelace" },
    }],
  });

  await engine.build();
  const results = await engine.search("lovelace");
  assertEquals(results.length, 1);
  assertEquals(results[0].page.route, "/pdf/manual.pdf");
});

Deno.test("injectedRecords: survive a rebuild alongside content pages", async () => {
  const engine = createSearchEngine({
    pages: [],
    storage: makeStorage(),
    contentDir: "content",
    formats: makeFormats(),
    injectedRecords: [PDF_RECORD],
  });

  await engine.build();
  // Rebuild with new pages — injected records are closure-retained.
  await engine.rebuild([makePage("about.md", "About Us")]);

  const pdfResults = await engine.search("revenue");
  assertEquals(pdfResults.length, 1);
  assertEquals(pdfResults[0].page.route, "/pdf/issue-1.pdf");
});

// ── Hook contract that bootstrap relies on ──────────────────────────────────

Deno.test("onSearchRecordsCollect: handlers push records into the payload", async () => {
  const hooks = createHookRegistry({
    config: {} as DuneConfig,
    storage: makeStorage(),
  });
  hooks.on<SearchRecordsCollectContext>("onSearchRecordsCollect", (ctx) => {
    ctx.data.records.push(PDF_RECORD);
  });

  const result = await hooks.fire<SearchRecordsCollectContext>(
    "onSearchRecordsCollect",
    { records: [] },
  );
  assertEquals(result.records.length, 1);
  assertEquals(result.records[0].route, "/pdf/issue-1.pdf");
});

Deno.test("onSearchEngineCreate: a handler can provide an alternative engine", async () => {
  const fakeEngine: SearchEngine = {
    build: () => Promise.resolve(),
    rebuild: () => Promise.resolve(),
    search: () =>
      Promise.resolve([
        { page: makePage("x.md", "X"), score: 1, excerpt: "from fake engine" },
      ]),
    suggest: () => Promise.resolve([]),
  };

  const hooks = createHookRegistry({
    config: {} as DuneConfig,
    storage: makeStorage(),
  });
  hooks.on<SearchEngineCreateContext>("onSearchEngineCreate", (ctx) => {
    ctx.data.engine = fakeEngine;
  });

  const result = await hooks.fire<SearchEngineCreateContext>(
    "onSearchEngineCreate",
    {
      engine: null,
      pages: [],
      injectedRecords: [],
      storage: makeStorage(),
      contentDir: "content",
      config: {} as DuneConfig,
      formats: makeFormats(),
      loadText: () => Promise.resolve(""),
      register: () => {},
      setActiveEngine: () => {},
    },
  );

  assertEquals(result.engine, fakeEngine);
  const hits = await result.engine!.search("anything");
  assertEquals(hits[0].excerpt, "from fake engine");
});

Deno.test("onSearchEngineCreate: engine stays null when no handler provides one", async () => {
  const hooks = createHookRegistry({
    config: {} as DuneConfig,
    storage: makeStorage(),
  });
  const result = await hooks.fire<SearchEngineCreateContext>(
    "onSearchEngineCreate",
    {
      engine: null,
      pages: [],
      injectedRecords: [],
      storage: makeStorage(),
      contentDir: "content",
      config: {} as DuneConfig,
      formats: makeFormats(),
      loadText: () => Promise.resolve(""),
      register: () => {},
      setActiveEngine: () => {},
    },
  );
  assertEquals(result.engine, null);
});
