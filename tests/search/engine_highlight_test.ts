/**
 * Tests for excerpt extraction and match highlighting.
 *
 * The engine returns `highlights` (matched query terms) and positions
 * the `excerpt` window to maximise term density.
 */

import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createSearchEngine } from "../../src/search/engine.ts";
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
// Tests — excerpt contains query term
// ---------------------------------------------------------------------------

Deno.test("highlight: excerpt contains the matched query term", async () => {
  const page = makePage({ title: "Page", sourcePath: "01.page/default.md" });
  const bodyMap = {
    "content/01.page/default.md": "The quick brown fox jumps over the lazy dog",
  };
  const engine = createSearchEngine({
    pages: [page],
    storage: makeStorage({ "content/01.page/default.md": "raw" }),
    contentDir: "content",
    formats: makeFormats(bodyMap),
    highlightMatches: true,
  });
  await engine.build();

  const results = engine.search("fox");
  assertEquals(results.length, 1);
  assertExists(results[0].excerpt);
  assertEquals(results[0].excerpt.toLowerCase().includes("fox"), true);
});

// ---------------------------------------------------------------------------
// Tests — highlights array includes matched term
// ---------------------------------------------------------------------------

Deno.test("highlight: highlights array includes the matched query term", async () => {
  const page = makePage({ title: "Page", sourcePath: "01.page/default.md" });
  const bodyMap = {
    "content/01.page/default.md": "TypeScript is a typed superset of JavaScript",
  };
  const engine = createSearchEngine({
    pages: [page],
    storage: makeStorage({ "content/01.page/default.md": "raw" }),
    contentDir: "content",
    formats: makeFormats(bodyMap),
    highlightMatches: true,
  });
  await engine.build();

  const results = engine.search("typescript");
  assertEquals(results.length, 1);
  assertExists(results[0].highlights);
  assertEquals(results[0].highlights!.includes("typescript"), true);
});

Deno.test("highlight: highlights omitted when highlightMatches=false", async () => {
  const page = makePage({ title: "Page", sourcePath: "01.page/default.md" });
  const bodyMap = {
    "content/01.page/default.md": "TypeScript is a typed superset of JavaScript",
  };
  const engine = createSearchEngine({
    pages: [page],
    storage: makeStorage({ "content/01.page/default.md": "raw" }),
    contentDir: "content",
    formats: makeFormats(bodyMap),
    highlightMatches: false,
  });
  await engine.build();

  const results = engine.search("typescript");
  assertEquals(results.length, 1);
  assertEquals(results[0].highlights, undefined);
});

Deno.test("highlight: multi-term query highlights all matched terms", async () => {
  const page = makePage({ title: "Page", sourcePath: "01.page/default.md" });
  const bodyMap = {
    "content/01.page/default.md": "Deno is a JavaScript runtime with TypeScript support",
  };
  const engine = createSearchEngine({
    pages: [page],
    storage: makeStorage({ "content/01.page/default.md": "raw" }),
    contentDir: "content",
    formats: makeFormats(bodyMap),
    highlightMatches: true,
  });
  await engine.build();

  const results = engine.search("deno typescript");
  assertEquals(results.length, 1);
  assertExists(results[0].highlights);
  assertEquals(results[0].highlights!.includes("deno"), true);
  assertEquals(results[0].highlights!.includes("typescript"), true);
});

// ---------------------------------------------------------------------------
// Tests — excerpt length
// ---------------------------------------------------------------------------

Deno.test("highlight: excerptLength controls excerpt length", async () => {
  const page = makePage({ title: "Page", sourcePath: "01.page/default.md" });
  // Body much longer than the configured excerpt length
  const longBody = "word ".repeat(500) + "target " + "word ".repeat(500);
  const bodyMap = { "content/01.page/default.md": longBody };

  const engine = createSearchEngine({
    pages: [page],
    storage: makeStorage({ "content/01.page/default.md": "raw" }),
    contentDir: "content",
    formats: makeFormats(bodyMap),
    excerptLength: 80,
  });
  await engine.build();

  const results = engine.search("target");
  assertEquals(results.length, 1);
  // The excerpt (trimmed, may include "...") should not be many times larger than excerptLength
  // We allow some overshoot for ellipsis and edge padding.
  assertEquals(results[0].excerpt.length <= 120, true);
});

Deno.test("highlight: excerpt is positioned near query term", async () => {
  const page = makePage({ title: "Page", sourcePath: "01.page/default.md" });
  // Term appears far into the body
  const preamble = "Lorem ipsum ".repeat(50);
  const bodyContent = preamble + "uniqueterm appears here";
  const bodyMap = { "content/01.page/default.md": bodyContent };

  const engine = createSearchEngine({
    pages: [page],
    storage: makeStorage({ "content/01.page/default.md": "raw" }),
    contentDir: "content",
    formats: makeFormats(bodyMap),
    highlightMatches: true,
  });
  await engine.build();

  const results = engine.search("uniqueterm");
  assertEquals(results.length, 1);
  // Excerpt should contain the term
  assertEquals(results[0].excerpt.toLowerCase().includes("uniqueterm"), true);
});
