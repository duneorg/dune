/**
 * Tests for Flex Object indexing in the search engine.
 *
 * When `flexRecords` is provided, records appear in search results with
 * a synthetic PageIndex at route /flex/{type}/{id}.
 */

import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createSearchEngine } from "../../src/search/engine.ts";
import { FormatRegistry } from "../../src/content/formats/registry.ts";
import type { StorageAdapter } from "../../src/storage/types.ts";
import type { PageIndex } from "../../src/content/types.ts";

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

function makeStorage(): StorageAdapter {
  return {
    readText: () => Promise.reject(new Error("not found")),
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

function makePage(overrides: Partial<PageIndex> & { title: string; sourcePath: string }): PageIndex {
  return {
    route: "/" + overrides.sourcePath.replace(/\/default\.md$/, "").replace(/^\d+\./, ""),
    language: "en",
    format: "md",
    template: "default",
    navTitle: overrides.title,
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
    mtime: Date.now(),
    hash: "abc",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test("flex indexing: flex record appears in search results", async () => {
  const engine = createSearchEngine({
    pages: [],
    storage: makeStorage(),
    contentDir: "content",
    formats: makeFormats(),
    flexRecords: [
      {
        type: "products",
        id: "abc123",
        fields: { title: "SuperWidget 3000", description: "An amazing product" },
      },
    ],
  });

  await engine.build();
  const results = engine.search("superwidget");
  assertEquals(results.length, 1);
  assertEquals(results[0].page.route, "/flex/products/abc123");
});

Deno.test("flex indexing: flex record route follows /flex/{type}/{id} pattern", async () => {
  const engine = createSearchEngine({
    pages: [],
    storage: makeStorage(),
    contentDir: "content",
    formats: makeFormats(),
    flexRecords: [
      {
        type: "events",
        id: "event-42",
        fields: { name: "Annual Conference", location: "Geneva" },
      },
    ],
  });

  await engine.build();
  const results = engine.search("conference");
  assertEquals(results.length, 1);
  assertExists(results[0].page);
  assertEquals(results[0].page.route, "/flex/events/event-42");
});

Deno.test("flex indexing: flex record title derived from 'name' field when 'title' absent", async () => {
  const engine = createSearchEngine({
    pages: [],
    storage: makeStorage(),
    contentDir: "content",
    formats: makeFormats(),
    flexRecords: [
      {
        type: "team",
        id: "user-1",
        fields: { name: "Alice Johnson", role: "engineer" },
      },
    ],
  });

  await engine.build();
  const results = engine.search("alice");
  assertEquals(results.length, 1);
  assertEquals(results[0].page.title, "Alice Johnson");
});

Deno.test("flex indexing: multiple flex types indexed independently", async () => {
  const engine = createSearchEngine({
    pages: [],
    storage: makeStorage(),
    contentDir: "content",
    formats: makeFormats(),
    flexRecords: [
      { type: "products", id: "p1", fields: { title: "Widget Alpha", category: "hardware" } },
      { type: "events", id: "e1", fields: { title: "Widget Beta Launch", date: "2026-06-01" } },
    ],
  });

  await engine.build();
  const results = engine.search("widget");
  assertEquals(results.length, 2);

  const routes = results.map((r) => r.page.route).sort();
  assertEquals(routes.includes("/flex/products/p1"), true);
  assertEquals(routes.includes("/flex/events/e1"), true);
});

Deno.test("flex indexing: flex records coexist with content pages", async () => {
  const contentPage = makePage({ title: "Content Article", sourcePath: "01.article/default.md" });

  const engine = createSearchEngine({
    pages: [contentPage],
    storage: makeStorage(),
    contentDir: "content",
    formats: makeFormats(),
    flexRecords: [
      { type: "products", id: "p1", fields: { title: "Product Article" } },
    ],
  });

  await engine.build();

  // Both content page and flex record should be findable
  const contentResults = engine.search("content");
  assertEquals(contentResults.length >= 1, true);
  assertEquals(contentResults.some((r) => r.page.sourcePath === contentPage.sourcePath), true);

  const flexResults = engine.search("product");
  assertEquals(flexResults.length >= 1, true);
  assertEquals(flexResults.some((r) => r.page.route === "/flex/products/p1"), true);
});

Deno.test("flex indexing: flex record with no matching query returns empty", async () => {
  const engine = createSearchEngine({
    pages: [],
    storage: makeStorage(),
    contentDir: "content",
    formats: makeFormats(),
    flexRecords: [
      { type: "products", id: "p1", fields: { title: "Banana Phone", brand: "FruitCo" } },
    ],
  });

  await engine.build();
  const results = engine.search("zzznomatch");
  assertEquals(results.length, 0);
});

Deno.test("flex indexing: flex record array field values are indexed", async () => {
  const engine = createSearchEngine({
    pages: [],
    storage: makeStorage(),
    contentDir: "content",
    formats: makeFormats(),
    flexRecords: [
      {
        type: "articles",
        id: "art-1",
        fields: { title: "Tech Roundup", tags: ["deno", "typescript", "webassembly"] },
      },
    ],
  });

  await engine.build();
  const results = engine.search("webassembly");
  assertEquals(results.length, 1);
  assertEquals(results[0].page.route, "/flex/articles/art-1");
});
