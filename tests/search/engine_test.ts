import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createSearchEngine } from "../../src/search/engine.ts";
import { FormatRegistry } from "../../src/content/formats/registry.ts";
import type { PageIndex } from "../../src/content/types.ts";
import type { StorageAdapter } from "../../src/storage/types.ts";

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

/** Stub storage — serves synthetic content keyed by path */
function makeStorage(files: Record<string, string> = {}): StorageAdapter {
  return {
    readText: (path: string) => {
      if (path in files) return Promise.resolve(files[path]);
      return Promise.reject(new Error(`Not found: ${path}`));
    },
    // The following are unused by the search engine but required by the type
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

/** Stub format registry with a simple Markdown handler */
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

/** Minimal published + routable PageIndex */
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
// Tests — build & search basics
// ---------------------------------------------------------------------------

Deno.test("search.build + search: empty query returns []", async () => {
  const engine = createSearchEngine({
    pages: [makePage({ title: "Hello", sourcePath: "01.hello/default.md" })],
    storage: makeStorage(),
    contentDir: "content",
    formats: makeFormats(),
  });
  await engine.build();
  assertEquals(engine.search(""), []);
});

Deno.test("search.build + search: single-word query finds matching page", async () => {
  const page = makePage({ title: "Hello World", sourcePath: "01.hello/default.md" });
  const engine = createSearchEngine({
    pages: [page],
    storage: makeStorage(),
    contentDir: "content",
    formats: makeFormats(),
  });
  await engine.build();
  const results = engine.search("hello");
  assertEquals(results.length, 1);
  assertEquals(results[0].page.sourcePath, page.sourcePath);
});

Deno.test("search.build + search: query for absent term returns []", async () => {
  const engine = createSearchEngine({
    pages: [makePage({ title: "Hello World", sourcePath: "01.hello/default.md" })],
    storage: makeStorage(),
    contentDir: "content",
    formats: makeFormats(),
  });
  await engine.build();
  const results = engine.search("zzznomatch");
  assertEquals(results.length, 0);
});

Deno.test("search.build: unpublished pages excluded", async () => {
  const page = makePage({ title: "Secret", sourcePath: "01.secret/default.md", published: false });
  const engine = createSearchEngine({
    pages: [page],
    storage: makeStorage(),
    contentDir: "content",
    formats: makeFormats(),
  });
  await engine.build();
  assertEquals(engine.search("secret"), []);
});

Deno.test("search.build: non-routable pages excluded", async () => {
  const page = makePage({ title: "Module", sourcePath: "01.module/default.md", routable: false });
  const engine = createSearchEngine({
    pages: [page],
    storage: makeStorage(),
    contentDir: "content",
    formats: makeFormats(),
  });
  await engine.build();
  assertEquals(engine.search("module"), []);
});

// ---------------------------------------------------------------------------
// Tests — body content
// ---------------------------------------------------------------------------

Deno.test("search: finds term in body content", async () => {
  const page = makePage({ title: "Page", sourcePath: "01.page/default.md" });
  const bodyMap = { "content/01.page/default.md": "The quick brown fox" };
  const engine = createSearchEngine({
    pages: [page],
    storage: makeStorage({ "content/01.page/default.md": "irrelevant raw" }),
    contentDir: "content",
    formats: makeFormats(bodyMap),
  });
  await engine.build();
  const results = engine.search("fox");
  assertEquals(results.length, 1);
  assertEquals(results[0].score > 0, true);
});

Deno.test("search: excerpt contains matched content", async () => {
  const page = makePage({ title: "Page", sourcePath: "01.page/default.md" });
  const bodyMap = { "content/01.page/default.md": "The quick brown fox jumps" };
  const engine = createSearchEngine({
    pages: [page],
    storage: makeStorage({ "content/01.page/default.md": "irrelevant raw" }),
    contentDir: "content",
    formats: makeFormats(bodyMap),
  });
  await engine.build();
  const results = engine.search("fox");
  assertExists(results[0].excerpt);
  assertEquals(results[0].excerpt.includes("fox"), true);
});

// ---------------------------------------------------------------------------
// Tests — scoring and ranking
// ---------------------------------------------------------------------------

Deno.test("search: title match scores higher than body-only match", async () => {
  const titlePage = makePage({ title: "Deno Runtime", sourcePath: "01.deno/default.md" });
  const bodyPage = makePage({ title: "Unrelated", sourcePath: "02.other/default.md" });
  // Provide storage so readText succeeds (raw content ignored by stub handler)
  const fileContent = {
    "content/01.deno/default.md": "raw",
    "content/02.other/default.md": "raw",
  };
  const bodyMap = {
    "content/01.deno/default.md": "nothing relevant",
    "content/02.other/default.md": "The deno runtime is fast",
  };
  const engine = createSearchEngine({
    pages: [titlePage, bodyPage],
    storage: makeStorage(fileContent),
    contentDir: "content",
    formats: makeFormats(bodyMap),
  });
  await engine.build();
  const results = engine.search("deno");
  assertEquals(results.length, 2);
  // Title-matched page should score higher
  assertEquals(results[0].page.sourcePath, titlePage.sourcePath);
});

Deno.test("search: multi-term query applies bonus multiplier", async () => {
  const page = makePage({ title: "Deno Guide", sourcePath: "01.deno/default.md" });
  const bodyMap = { "content/01.deno/default.md": "deno guide for beginners" };
  const engine = createSearchEngine({
    pages: [page],
    storage: makeStorage(),
    contentDir: "content",
    formats: makeFormats(bodyMap),
  });
  await engine.build();
  const singleResult = engine.search("deno");
  const multiResult = engine.search("deno guide");
  // Multi-term should score >= single term (bonus applied)
  assertEquals(multiResult[0].score >= singleResult[0].score, true);
});

Deno.test("search: results sorted by score descending", async () => {
  const p1 = makePage({ title: "Deno Deno Deno", sourcePath: "01.p1/default.md" }); // title matches 3x word
  const p2 = makePage({ title: "Unrelated", sourcePath: "02.p2/default.md" });
  // Provide storage so readText succeeds (raw content ignored by stub handler)
  const fileContent = {
    "content/01.p1/default.md": "raw",
    "content/02.p2/default.md": "raw",
  };
  const bodyMap = {
    "content/01.p1/default.md": "deno deno deno",
    "content/02.p2/default.md": "one mention of deno here",
  };
  const engine = createSearchEngine({
    pages: [p1, p2],
    storage: makeStorage(fileContent),
    contentDir: "content",
    formats: makeFormats(bodyMap),
  });
  await engine.build();
  const results = engine.search("deno");
  assertEquals(results.length >= 2, true);
  // Each result's score <= previous result's score
  for (let i = 1; i < results.length; i++) {
    assertEquals(results[i].score <= results[i - 1].score, true);
  }
});

Deno.test("search: limit parameter restricts result count", async () => {
  const pages = Array.from({ length: 5 }, (_, i) =>
    makePage({ title: `Page ${i}`, sourcePath: `0${i + 1}.page/default.md` })
  );
  const engine = createSearchEngine({
    pages,
    storage: makeStorage(),
    contentDir: "content",
    formats: makeFormats(),
  });
  await engine.build();
  const results = engine.search("page", 3);
  assertEquals(results.length <= 3, true);
});

// ---------------------------------------------------------------------------
// Tests — taxonomy scoring
// ---------------------------------------------------------------------------

Deno.test("search: taxonomy match boosts score", async () => {
  const tagged = makePage({
    title: "Article",
    sourcePath: "01.article/default.md",
    taxonomy: { tag: ["typescript"] },
  });
  const untagged = makePage({
    title: "Post",
    sourcePath: "02.post/default.md",
  });
  const engine = createSearchEngine({
    pages: [tagged, untagged],
    storage: makeStorage(),
    contentDir: "content",
    formats: makeFormats(),
  });
  await engine.build();
  const results = engine.search("typescript");
  assertEquals(results.length, 1);
  assertEquals(results[0].page.sourcePath, tagged.sourcePath);
});

// ---------------------------------------------------------------------------
// Tests — prefix matching
// ---------------------------------------------------------------------------

Deno.test("search: prefix matching — partial term finds page", async () => {
  const page = makePage({ title: "Getting Started Guide", sourcePath: "01.guide/default.md" });
  const engine = createSearchEngine({
    pages: [page],
    storage: makeStorage(),
    contentDir: "content",
    formats: makeFormats(),
  });
  await engine.build();
  // "gett" is a prefix of "getting"
  const results = engine.search("gett");
  assertEquals(results.length, 1);
});

// ---------------------------------------------------------------------------
// Tests — rebuild
// ---------------------------------------------------------------------------

Deno.test("search.rebuild: swaps indexed pages", async () => {
  const page1 = makePage({ title: "OldPage", sourcePath: "01.old/default.md" });
  const engine = createSearchEngine({
    pages: [page1],
    storage: makeStorage(),
    contentDir: "content",
    formats: makeFormats(),
  });
  await engine.build();
  assertEquals(engine.search("oldpage").length, 1);

  const page2 = makePage({ title: "NewPage", sourcePath: "02.new/default.md" });
  await engine.rebuild([page2]);
  assertEquals(engine.search("oldpage").length, 0);
  assertEquals(engine.search("newpage").length, 1);
});

Deno.test("search.rebuild: search works after rebuild with empty set", async () => {
  const page = makePage({ title: "Hello", sourcePath: "01.hello/default.md" });
  const engine = createSearchEngine({
    pages: [page],
    storage: makeStorage(),
    contentDir: "content",
    formats: makeFormats(),
  });
  await engine.build();
  await engine.rebuild([]);
  assertEquals(engine.search("hello"), []);
});

// ---------------------------------------------------------------------------
// Tests — storage read failure graceful
// ---------------------------------------------------------------------------

Deno.test("search.build: storage read failure falls back to metadata-only index", async () => {
  const page = makePage({ title: "SpecialTitle", sourcePath: "01.special/default.md" });
  // Storage always rejects — simulates unreadable file
  const engine = createSearchEngine({
    pages: [page],
    storage: makeStorage(), // no files → readText will reject
    contentDir: "content",
    formats: makeFormats(),
  });
  // Should not throw; falls back to metadata indexing
  await engine.build();
  // Title is still indexed (metadata)
  const results = engine.search("specialtitle");
  assertEquals(results.length, 1);
});
