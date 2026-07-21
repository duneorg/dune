/**
 * Tests for the built-in search engine's `search(query, limit, options)`
 * filter/sort support and the `facetCounts()` method.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createSearchEngine } from "../../src/search/engine.ts";
import { FormatRegistry } from "../../src/content/formats/registry.ts";
import type { PageIndex } from "../../src/content/types.ts";
import type { StorageAdapter } from "../../src/storage/types.ts";

function makeStorage(files: Record<string, string> = {}): StorageAdapter {
  return {
    readText: (path: string) => {
      if (path in files) return Promise.resolve(files[path]);
      return Promise.reject(new Error(`Not found: ${path}`));
    },
    exists: () => Promise.resolve(false),
    readBytes: () => Promise.reject(new Error("not implemented")),
    write: () => Promise.reject(new Error("not implemented")),
    delete: () => Promise.reject(new Error("not implemented")),
    list: () => Promise.resolve([]),
    listRecursive: () => Promise.resolve([]),
    move: () => Promise.reject(new Error("not implemented")),
    copy: () => Promise.reject(new Error("not implemented")),
  } as unknown as StorageAdapter;
}

function makeFormats(bodyMap: Record<string, string> = {}): FormatRegistry {
  const registry = new FormatRegistry();
  registry.register({
    extensions: [".md"],
    extractFrontmatter: () => Promise.resolve({ title: "" }),
    extractBody: (_raw: string, filePath: string) => bodyMap[filePath] ?? null,
    renderToHtml: () => Promise.resolve(""),
  });
  return registry;
}

function makePage(
  overrides: Partial<PageIndex> & { title: string; sourcePath: string },
): PageIndex {
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

const bodyMap = {
  "content/01.a/default.md": "europe policy discussion",
  "content/02.b/default.md": "europe policy discussion",
  "content/03.c/default.md": "europe policy discussion",
};

function makePages(): PageIndex[] {
  return [
    makePage({
      title: "Article A",
      sourcePath: "01.a/default.md",
      template: "article",
      extra: { subtype: "artikel" },
      date: "2020-01-01",
    }),
    makePage({
      title: "Post B",
      sourcePath: "02.b/default.md",
      template: "post",
      extra: { subtype: "kurzinfo" },
      date: "2022-01-01",
    }),
    makePage({
      title: "PDF C",
      sourcePath: "03.c/default.md",
      template: "pdf",
      extra: { subtype: "pdf" },
      date: "2021-01-01",
    }),
  ];
}

Deno.test("search options: filter narrows to matching field=value", async () => {
  const engine = createSearchEngine({
    pages: makePages(),
    storage: makeStorage(bodyMap),
    contentDir: "content",
    formats: makeFormats(bodyMap),
  });
  await engine.build();

  const results = await engine.search("europe", 10, {
    filter: { field: "subtype", value: "artikel" },
  });
  assertEquals(results.length, 1);
  assertEquals(results[0].page.title, "Article A");
});

Deno.test("search options: filter on template field works without extra", async () => {
  const engine = createSearchEngine({
    pages: makePages(),
    storage: makeStorage(bodyMap),
    contentDir: "content",
    formats: makeFormats(bodyMap),
  });
  await engine.build();

  const results = await engine.search("europe", 10, {
    filter: { field: "template", value: "pdf" },
  });
  assertEquals(results.length, 1);
  assertEquals(results[0].page.title, "PDF C");
});

Deno.test("search options: no filter returns all matches", async () => {
  const engine = createSearchEngine({
    pages: makePages(),
    storage: makeStorage(bodyMap),
    contentDir: "content",
    formats: makeFormats(bodyMap),
  });
  await engine.build();

  const results = await engine.search("europe", 10);
  assertEquals(results.length, 3);
});

Deno.test("search options: offset skips the first N results", async () => {
  const engine = createSearchEngine({
    pages: makePages(),
    storage: makeStorage(bodyMap),
    contentDir: "content",
    formats: makeFormats(bodyMap),
  });
  await engine.build();

  const all = await engine.search("europe", 10, { sort: "date" });
  const skipped = await engine.search("europe", 10, { sort: "date", offset: 1 });
  assertEquals(skipped.map((r) => r.page.title), all.slice(1).map((r) => r.page.title));
});

Deno.test("search options: offset + limit pages through results without gaps or dupes", async () => {
  const engine = createSearchEngine({
    pages: makePages(),
    storage: makeStorage(bodyMap),
    contentDir: "content",
    formats: makeFormats(bodyMap),
  });
  await engine.build();

  const page1 = await engine.search("europe", 2, { sort: "date", offset: 0 });
  const page2 = await engine.search("europe", 2, { sort: "date", offset: 2 });
  assertEquals(page1.length, 2);
  assertEquals(page2.length, 1);
  assertEquals(
    [...page1, ...page2].map((r) => r.page.title),
    ["Post B", "PDF C", "Article A"],
  );
});

Deno.test("search options: offset beyond the result count returns an empty page", async () => {
  const engine = createSearchEngine({
    pages: makePages(),
    storage: makeStorage(bodyMap),
    contentDir: "content",
    formats: makeFormats(bodyMap),
  });
  await engine.build();

  const results = await engine.search("europe", 10, { offset: 100 });
  assertEquals(results, []);
});

Deno.test("search options: sort=date orders newest first regardless of score", async () => {
  const engine = createSearchEngine({
    pages: makePages(),
    storage: makeStorage(bodyMap),
    contentDir: "content",
    formats: makeFormats(bodyMap),
  });
  await engine.build();

  const results = await engine.search("europe", 10, { sort: "date" });
  assertEquals(results.map((r) => r.page.title), ["Post B", "PDF C", "Article A"]);
});

Deno.test("search options: default sort is relevance (score descending)", async () => {
  const engine = createSearchEngine({
    pages: makePages(),
    storage: makeStorage(bodyMap),
    contentDir: "content",
    formats: makeFormats(bodyMap),
  });
  await engine.build();

  const results = await engine.search("europe", 10);
  for (let i = 1; i < results.length; i++) {
    assertEquals(results[i - 1].score >= results[i].score, true);
  }
});

Deno.test("facetCounts: counts distinct field values across all matches, ignoring limit", async () => {
  const engine = createSearchEngine({
    pages: makePages(),
    storage: makeStorage(bodyMap),
    contentDir: "content",
    formats: makeFormats(bodyMap),
  });
  await engine.build();

  const counts = await engine.facetCounts!("europe", "subtype");
  assertEquals(counts, { artikel: 1, kurzinfo: 1, pdf: 1 });
});

Deno.test("facetCounts: empty query returns empty counts", async () => {
  const engine = createSearchEngine({
    pages: makePages(),
    storage: makeStorage(bodyMap),
    contentDir: "content",
    formats: makeFormats(bodyMap),
  });
  await engine.build();

  const counts = await engine.facetCounts!("", "subtype");
  assertEquals(counts, {});
});

Deno.test("facetCounts: field with no matches yields empty counts object", async () => {
  const engine = createSearchEngine({
    pages: makePages(),
    storage: makeStorage(bodyMap),
    contentDir: "content",
    formats: makeFormats(bodyMap),
  });
  await engine.build();

  const counts = await engine.facetCounts!("zzznomatch", "subtype");
  assertEquals(counts, {});
});
