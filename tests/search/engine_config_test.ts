/**
 * Tests for field weight configuration in the search engine.
 *
 * Verifies that `fieldWeights` in SearchEngineOptions causes title matches
 * to rank higher than body-only matches when the title weight is elevated,
 * and vice-versa.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createSearchEngine } from "../../src/search/engine.ts";
import { FormatRegistry } from "../../src/content/formats/registry.ts";
import type { PageIndex } from "../../src/content/types.ts";
import type { StorageAdapter } from "../../src/storage/types.ts";

// ---------------------------------------------------------------------------
// Stubs (mirrors engine_test.ts)
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

Deno.test("fieldWeights: high title weight makes title match rank above body match", async () => {
  // titlePage has the query term only in its title; bodyPage has it only in its body.
  // With title weight=10 and body weight=1, the title match must win.
  const titlePage = makePage({ title: "Deno Runtime", sourcePath: "01.deno/default.md" });
  const bodyPage = makePage({ title: "Unrelated Article", sourcePath: "02.other/default.md" });

  const files = {
    "content/01.deno/default.md": "raw",
    "content/02.other/default.md": "raw",
  };
  const bodies = {
    "content/01.deno/default.md": "nothing relevant here",
    "content/02.other/default.md":
      "deno deno deno deno deno deno deno deno deno deno deno deno",
  };

  const engine = createSearchEngine({
    pages: [titlePage, bodyPage],
    storage: makeStorage(files),
    contentDir: "content",
    formats: makeFormats(bodies),
    fieldWeights: { title: 10, body: 1 },
  });

  await engine.build();
  const results = await engine.search("deno");

  assertEquals(results.length >= 2, true);
  // High title weight → title match must be first
  assertEquals(results[0].page.sourcePath, titlePage.sourcePath);
});

Deno.test("fieldWeights: high body weight makes body match rank above title match", async () => {
  // With body weight=10 and title weight=1, a page with many body occurrences
  // should beat a page with only a title match and no body content.
  const titlePage = makePage({ title: "Deno Runtime", sourcePath: "01.deno/default.md" });
  const bodyPage = makePage({ title: "Unrelated Article", sourcePath: "02.other/default.md" });

  const files = {
    "content/01.deno/default.md": "raw",
    "content/02.other/default.md": "raw",
  };
  const bodies = {
    "content/01.deno/default.md": "",
    "content/02.other/default.md":
      "deno deno deno deno deno",
  };

  const engine = createSearchEngine({
    pages: [titlePage, bodyPage],
    storage: makeStorage(files),
    contentDir: "content",
    formats: makeFormats(bodies),
    fieldWeights: { title: 1, body: 10 },
  });

  await engine.build();
  const results = await engine.search("deno");

  assertEquals(results.length >= 2, true);
  // High body weight → body-rich page must be first
  assertEquals(results[0].page.sourcePath, bodyPage.sourcePath);
});

Deno.test("fieldWeights: default weight (omitted) behaves as weight=1", async () => {
  // Regression: omitting fieldWeights should not throw and should return results
  const page = makePage({ title: "Hello World", sourcePath: "01.hello/default.md" });
  const engine = createSearchEngine({
    pages: [page],
    storage: makeStorage(),
    contentDir: "content",
    formats: makeFormats(),
    // No fieldWeights supplied
  });
  await engine.build();
  const results = await engine.search("hello");
  assertEquals(results.length, 1);
});

Deno.test("fieldWeights: custom field weight affects ranking", async () => {
  // Page A has a high-weight custom field match; Page B has a title match only.
  // With customField weight=10, Page A (only custom field match) should score higher.
  const pageA = makePage({ title: "Neutral", sourcePath: "01.a/default.md" });
  const pageB = makePage({ title: "Typescript", sourcePath: "02.b/default.md" });

  const files: Record<string, string> = {
    "content/01.a/default.md": "raw",
    "content/02.b/default.md": "raw",
  };
  // Custom field "tags" on page A contains the query term
  const bodies: Record<string, string> = {
    "content/01.a/default.md": "",
    "content/02.b/default.md": "",
  };

  // Use a format handler that returns "typescript" for custom field "tags" on page A
  const registry = new FormatRegistry();
  registry.register({
    extensions: [".md"],
    extractFrontmatter: (_raw: string, filePath: string) => {
      if (filePath.includes("01.a")) {
        return Promise.resolve({ title: "Neutral", tags: "typescript" });
      }
      return Promise.resolve({ title: "Typescript" });
    },
    extractBody: (_raw: string, filePath: string) => bodies[filePath] ?? null,
    renderToHtml: () => Promise.resolve(""),
  });

  const engine = createSearchEngine({
    pages: [pageA, pageB],
    storage: makeStorage(files),
    contentDir: "content",
    formats: registry,
    customFields: ["tags"],
    fieldWeights: { title: 1, tags: 10 },
  });

  await engine.build();
  const results = await engine.search("typescript");
  assertEquals(results.length >= 1, true);
  // pageA's custom field weight=10 should score at least as high as pageB's title match
  // (pageB gets title weight=1 ×3 = 3; pageA gets custom field weight=10 ×1 = 10)
  assertEquals(results[0].page.sourcePath, pageA.sourcePath);
});
