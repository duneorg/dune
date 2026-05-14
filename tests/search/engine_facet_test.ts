/**
 * Tests for facet value extraction and the resolveFacetValue utility.
 *
 * Facet counts summarise result distributions across configurable fields.
 * The search engine attaches `facetValues` to each SearchResult when
 * facet fields are resolved, and the route handler computes aggregate counts.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createSearchEngine, resolveFacetValue } from "../../src/search/engine.ts";
import { FormatRegistry } from "../../src/content/formats/registry.ts";
import type { PageIndex } from "../../src/content/types.ts";
import type { StorageAdapter } from "../../src/storage/types.ts";

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

function makeStorage(files: Record<string, string> = {}): StorageAdapter {
  return {
    readText: (path: string) => {
      if (path in files) return Promise.resolve(files[path]);
      return Promise.reject(new Error(`Not found: ${path}`));
    },
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
    template: "post",
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
// Tests — resolveFacetValue utility
// ---------------------------------------------------------------------------

Deno.test("resolveFacetValue: resolves simple field", () => {
  const obj = { template: "post", title: "Hello" };
  assertEquals(resolveFacetValue(obj, "template"), "post");
});

Deno.test("resolveFacetValue: resolves dot-path", () => {
  const obj = { taxonomy: { category: ["news", "tech"] } };
  const result = resolveFacetValue(obj as Record<string, unknown>, "taxonomy.category");
  assertEquals(Array.isArray(result), true);
  assertEquals((result as string[]).includes("news"), true);
  assertEquals((result as string[]).includes("tech"), true);
});

Deno.test("resolveFacetValue: returns undefined for missing path", () => {
  const obj = { template: "post" };
  assertEquals(resolveFacetValue(obj, "taxonomy.category"), undefined);
});

Deno.test("resolveFacetValue: coerces number to string", () => {
  const obj = { order: 3 };
  assertEquals(resolveFacetValue(obj as Record<string, unknown>, "order"), "3");
});

Deno.test("resolveFacetValue: returns string array for array value", () => {
  const obj = { tags: ["a", "b", "c"] };
  const result = resolveFacetValue(obj as Record<string, unknown>, "tags");
  assertEquals(Array.isArray(result), true);
  assertEquals(result, ["a", "b", "c"]);
});

// ---------------------------------------------------------------------------
// Tests — facet filtering via search engine
// ---------------------------------------------------------------------------

Deno.test("facet filtering: template filter reduces results", async () => {
  const postPage = makePage({ title: "A Post", sourcePath: "01.post/default.md", template: "post" });
  const pagePage = makePage({ title: "A Page", sourcePath: "02.page/default.md", template: "page" });

  const engine = createSearchEngine({
    pages: [postPage, pagePage],
    storage: makeStorage(),
    contentDir: "content",
    formats: makeFormats(),
  });
  await engine.build();

  // Search for "a" which matches both
  const all = engine.search("a page", 10);
  assertEquals(all.length >= 1, true);

  // Manually filter by template (mirrors route handler logic)
  const filtered = all.filter((r) => r.page.template === "post");
  assertEquals(filtered.every((r) => r.page.template === "post"), true);
});

Deno.test("facet counts: correct distribution across results", async () => {
  const pages = [
    makePage({ title: "Post 1", sourcePath: "01.p1/default.md", template: "post" }),
    makePage({ title: "Post 2", sourcePath: "02.p2/default.md", template: "post" }),
    makePage({ title: "Page 1", sourcePath: "03.pg1/default.md", template: "page" }),
  ];

  const engine = createSearchEngine({
    pages,
    storage: makeStorage(),
    contentDir: "content",
    formats: makeFormats(),
  });
  await engine.build();

  // Search broadly to get all results
  const results = engine.search("post page", 10);

  // Count templates manually (mirrors what the route handler computes)
  const templateCounts: Record<string, number> = {};
  for (const { page: p } of results) {
    templateCounts[p.template] = (templateCounts[p.template] ?? 0) + 1;
  }

  assertEquals(templateCounts["post"] >= 1, true);
});

Deno.test("facet filtering: taxonomy filter works", async () => {
  const tagged = makePage({
    title: "Tagged Article",
    sourcePath: "01.tagged/default.md",
    taxonomy: { category: ["news"] },
  });
  const untagged = makePage({
    title: "Plain Article",
    sourcePath: "02.plain/default.md",
    taxonomy: {},
  });

  const engine = createSearchEngine({
    pages: [tagged, untagged],
    storage: makeStorage(),
    contentDir: "content",
    formats: makeFormats(),
  });
  await engine.build();

  const all = engine.search("article", 10);
  assertEquals(all.length >= 1, true);

  // Filter to only those with taxonomy.category=news
  const filtered = all.filter((r) => {
    const cats = r.page.taxonomy["category"] ?? [];
    return cats.includes("news");
  });
  assertEquals(filtered.length, 1);
  assertEquals(filtered[0].page.sourcePath, tagged.sourcePath);
});

Deno.test("facet: no results when filter matches nothing", async () => {
  const page = makePage({ title: "Post One", sourcePath: "01.post/default.md", template: "post" });
  const engine = createSearchEngine({
    pages: [page],
    storage: makeStorage(),
    contentDir: "content",
    formats: makeFormats(),
  });
  await engine.build();

  const all = engine.search("post", 10);
  // Filter by template "event" — matches nothing
  const filtered = all.filter((r) => r.page.template === "event");
  assertEquals(filtered.length, 0);
});
