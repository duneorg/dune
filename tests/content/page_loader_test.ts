import { assertEquals, assertExists, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { loadPage, getMimeType } from "../../src/content/page-loader.ts";
import { FormatRegistry } from "../../src/content/formats/registry.ts";
import type { StorageAdapter, StorageEntry } from "../../src/storage/types.ts";
import type { PageIndex, Page, PageFrontmatter } from "../../src/content/types.ts";

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

/** Build a storage stub from a file map (path → content) */
function makeStorage(files: Record<string, string> = {}): StorageAdapter {
  return {
    exists: (path: string) => Promise.resolve(path in files),
    readText: (path: string) => {
      if (path in files) return Promise.resolve(files[path]);
      return Promise.reject(new Error(`readText: not found: ${path}`));
    },
    // list() is used by discoverMedia — return empty list by default
    list: (_dir: string): Promise<StorageEntry[]> => Promise.resolve([]),
    stat: () => Promise.resolve({ size: 100, mtime: 1000, isFile: true, isDirectory: false }),
    read: (path: string) => {
      const c = files[path];
      if (c !== undefined) return Promise.resolve(new TextEncoder().encode(c));
      return Promise.reject(new Error(`read: not found: ${path}`));
    },
    // Unused
    readBytes: () => Promise.reject(new Error("n/a")),
    write: () => Promise.reject(new Error("n/a")),
    delete: () => Promise.reject(new Error("n/a")),
    listRecursive: () => Promise.resolve([]),
    move: () => Promise.reject(new Error("n/a")),
    copy: () => Promise.reject(new Error("n/a")),
  } as unknown as StorageAdapter;
}

/** Format registry with a stub .md handler */
function makeFormats(
  frontmatter: Partial<PageFrontmatter> = {},
  body = "",
  renderedHtml = "<p>content</p>",
): FormatRegistry {
  const registry = new FormatRegistry();
  registry.register({
    extensions: [".md"],
    extractFrontmatter: () =>
      Promise.resolve({
        title: "Test",
        published: true,
        visible: true,
        taxonomy: {},
        ...frontmatter,
      } as PageFrontmatter),
    extractBody: () => body || null,
    renderToHtml: () => Promise.resolve(renderedHtml),
  });
  return registry;
}

/** Minimal PageIndex helper */
function makeIndex(overrides: Partial<PageIndex> & { sourcePath: string }): PageIndex {
  return {
    route: "/test",
    language: "en",
    format: "md",
    template: "default",
    title: "Test",
    navTitle: "Test",
    date: null,
    published: true,
    status: "published",
    visible: true,
    routable: true,
    isModule: false,
    order: 1,
    depth: 0,
    parentPath: null,
    taxonomy: {},
    mtime: 1000,
    hash: "abc",
    ...overrides,
  };
}

/** Minimal loadPage stub that resolves Page from a pre-built map */
function makeLoadPage(pages: Page[]): (sourcePath: string) => Promise<Page> {
  const map = new Map(pages.map((p) => [p.sourcePath, p]));
  return (sp: string) => {
    const p = map.get(sp);
    if (!p) return Promise.reject(new Error(`loadPage: not found: ${sp}`));
    return Promise.resolve(p);
  };
}

// ---------------------------------------------------------------------------
// Tests — getMimeType (exported pure function)
// ---------------------------------------------------------------------------

Deno.test("getMimeType: known extensions return correct MIME types", () => {
  assertEquals(getMimeType("photo.jpg"), "image/jpeg");
  assertEquals(getMimeType("photo.jpeg"), "image/jpeg");
  assertEquals(getMimeType("image.png"), "image/png");
  assertEquals(getMimeType("image.webp"), "image/webp");
  assertEquals(getMimeType("video.mp4"), "video/mp4");
  assertEquals(getMimeType("doc.pdf"), "application/pdf");
  assertEquals(getMimeType("data.json"), "application/json");
});

Deno.test("getMimeType: unknown extension falls back to octet-stream", () => {
  assertEquals(getMimeType("file.xyz"), "application/octet-stream");
  assertEquals(getMimeType("noextension"), "application/octet-stream");
});

Deno.test("getMimeType: case-insensitive extension matching", () => {
  assertEquals(getMimeType("photo.JPG"), "image/jpeg");
  assertEquals(getMimeType("image.PNG"), "image/png");
});

// ---------------------------------------------------------------------------
// Tests — loadPage: basic field projection
// ---------------------------------------------------------------------------

Deno.test("loadPage: preserves route, language, template, navTitle from index", async () => {
  const index = makeIndex({
    sourcePath: "01.home/default.md",
    route: "/home",
    language: "de",
    template: "post",
    navTitle: "Startseite",
  });
  const storage = makeStorage({ "content/01.home/default.md": "---\ntitle: Home\n---\n" });
  const page = await loadPage(index, {
    storage,
    contentDir: "content",
    formats: makeFormats({ title: "Home" }),
    pages: [index],
    loadPage: makeLoadPage([]),
    orphanProtection: false,
  });

  assertEquals(page.route, "/home");
  assertEquals(page.language, "de");
  assertEquals(page.template, "post");
  assertEquals(page.navTitle, "Startseite");
});

Deno.test("loadPage: frontmatter is extracted and available", async () => {
  const index = makeIndex({ sourcePath: "01.home/default.md" });
  const storage = makeStorage({ "content/01.home/default.md": "---\ntitle: My Page\n---\n" });
  const page = await loadPage(index, {
    storage,
    contentDir: "content",
    formats: makeFormats({ title: "My Page" }),
    pages: [index],
    loadPage: makeLoadPage([]),
    orphanProtection: false,
  });

  assertEquals(page.frontmatter.title, "My Page");
});

Deno.test("loadPage: throws ContentError when content file missing", async () => {
  const index = makeIndex({ sourcePath: "01.missing/default.md" });
  const storage = makeStorage({}); // empty storage — file doesn't exist

  await assertRejects(
    () =>
      loadPage(index, {
        storage,
        contentDir: "content",
        formats: makeFormats(),
        pages: [index],
        loadPage: makeLoadPage([]),
      }),
    Error,
    "Content file not found",
  );
});

// ---------------------------------------------------------------------------
// Tests — lazy html()
// ---------------------------------------------------------------------------

Deno.test("html(): calls format handler renderToHtml", async () => {
  const index = makeIndex({ sourcePath: "01.home/default.md" });
  const storage = makeStorage({ "content/01.home/default.md": "---\ntitle: Test\n---\n\nHello world" });
  const page = await loadPage(index, {
    storage,
    contentDir: "content",
    formats: makeFormats({}, "Hello world", "<p>Hello world</p>"),
    pages: [index],
    loadPage: makeLoadPage([]),
    orphanProtection: false,
  });

  const html = await page.html();
  assertEquals(html, "<p>Hello world</p>");
});

Deno.test("html(): returns empty string for TSX format pages", async () => {
  const index = makeIndex({ sourcePath: "01.home/default.tsx", format: "tsx" });
  const storage = makeStorage({ "content/01.home/default.tsx": "" });
  const registry = new FormatRegistry();
  registry.register({
    extensions: [".tsx"],
    extractFrontmatter: () => Promise.resolve({ title: "TSX Page", published: true, visible: true, taxonomy: {} } as PageFrontmatter),
    extractBody: () => null,
    renderToHtml: () => Promise.resolve("<div>TSX</div>"),
  });
  const page = await loadPage(index, {
    storage,
    contentDir: "content",
    formats: registry,
    pages: [index],
    loadPage: makeLoadPage([]),
    orphanProtection: false,
  });

  const html = await page.html();
  // TSX format: html() returns "" (component renders itself)
  assertEquals(html, "");
});

// ---------------------------------------------------------------------------
// Tests — lazy summary()
// ---------------------------------------------------------------------------

Deno.test("summary(): strips markdown and returns excerpt", async () => {
  const index = makeIndex({ sourcePath: "01.home/default.md" });
  const body = "## Header\n\nSome **bold** and *italic* text with a [link](http://example.com).";
  const storage = makeStorage({ "content/01.home/default.md": "---\ntitle: T\n---\n" + body });
  const page = await loadPage(index, {
    storage,
    contentDir: "content",
    formats: makeFormats({}, body),
    pages: [index],
    loadPage: makeLoadPage([]),
    orphanProtection: false,
  });

  const summary = await page.summary();
  // Should not contain markdown syntax
  assertEquals(summary.includes("##"), false);
  assertEquals(summary.includes("**"), false);
  assertEquals(summary.includes("[link]"), false);
  // Should contain the actual words
  assertEquals(summary.includes("bold"), true);
  assertEquals(summary.includes("italic"), true);
});

Deno.test("summary(): falls back to frontmatter title when no body", async () => {
  const index = makeIndex({ sourcePath: "01.home/default.md" });
  const storage = makeStorage({ "content/01.home/default.md": "---\ntitle: My Title\n---\n" });
  const page = await loadPage(index, {
    storage,
    contentDir: "content",
    formats: makeFormats({ title: "My Title" }, null as unknown as string), // no body
    pages: [index],
    loadPage: makeLoadPage([]),
    orphanProtection: false,
  });

  const summary = await page.summary();
  assertEquals(summary, "My Title");
});

// ---------------------------------------------------------------------------
// Tests — lazy children()
// ---------------------------------------------------------------------------

Deno.test("children(): returns direct children sorted by order", async () => {
  const parentIndex = makeIndex({ sourcePath: "01.blog/default.md", route: "/blog", depth: 0, parentPath: null });
  const child1 = makeIndex({ sourcePath: "01.blog/02.second/default.md", route: "/blog/second", depth: 1, parentPath: "01.blog", order: 2 });
  const child2 = makeIndex({ sourcePath: "01.blog/01.first/default.md", route: "/blog/first", depth: 1, parentPath: "01.blog", order: 1 });
  const unrelated = makeIndex({ sourcePath: "02.about/default.md", route: "/about", depth: 0, parentPath: null });

  const allPages = [parentIndex, child1, child2, unrelated];
  const storage = makeStorage({
    "content/01.blog/default.md": "---\ntitle: Blog\n---\n",
    "content/01.blog/02.second/default.md": "---\ntitle: Second\n---\n",
    "content/01.blog/01.first/default.md": "---\ntitle: First\n---\n",
  });

  // Build stub pages for loadPage — navTitle must match the actual sourcePath
  // child1 = 02.second (order 2), child2 = 01.first (order 1)
  const stubSecondPage: Page = {
    sourcePath: child1.sourcePath,   // "01.blog/02.second/default.md"
    route: child1.route,
    language: "en",
    format: "md",
    template: "default",
    navTitle: "Second",
    frontmatter: { title: "Second", published: true, visible: true, taxonomy: {} } as PageFrontmatter,
    rawContent: null,
    html: () => Promise.resolve(""),
    component: () => Promise.resolve(null),
    media: [],
    order: 2,
    depth: 1,
    isModule: false,
    modules: () => Promise.resolve([]),
    parent: () => Promise.resolve(null),
    children: () => Promise.resolve([]),
    siblings: () => Promise.resolve([]),
    summary: () => Promise.resolve(""),
  };
  const stubFirstPage: Page = { ...stubSecondPage, sourcePath: child2.sourcePath, route: child2.route, navTitle: "First", order: 1 };

  const loadPageFn = makeLoadPage([stubSecondPage, stubFirstPage]);

  const parentPage = await loadPage(parentIndex, {
    storage,
    contentDir: "content",
    formats: makeFormats(),
    pages: allPages,
    loadPage: loadPageFn,
    orphanProtection: false,
  });

  const children = await parentPage.children();
  assertEquals(children.length, 2);
  // Sorted by order: first (1) before second (2)
  assertEquals(children[0].navTitle, "First");
  assertEquals(children[1].navTitle, "Second");
});

// ---------------------------------------------------------------------------
// Tests — lazy siblings()
// ---------------------------------------------------------------------------

Deno.test("siblings(): returns pages with same parentPath, excluding self", async () => {
  const sib1 = makeIndex({ sourcePath: "01.blog/01.post-a/default.md", route: "/blog/post-a", depth: 1, parentPath: "01.blog", order: 1 });
  const sib2 = makeIndex({ sourcePath: "01.blog/02.post-b/default.md", route: "/blog/post-b", depth: 1, parentPath: "01.blog", order: 2 });
  const other = makeIndex({ sourcePath: "02.news/01.item/default.md", route: "/news/item", depth: 1, parentPath: "02.news", order: 1 });

  const storage = makeStorage({ "content/01.blog/01.post-a/default.md": "---\ntitle: A\n---\n" });

  const sib2Page: Page = {
    sourcePath: sib2.sourcePath,
    route: sib2.route,
    language: "en",
    format: "md",
    template: "default",
    navTitle: "Post B",
    frontmatter: { title: "Post B", published: true, visible: true, taxonomy: {} } as PageFrontmatter,
    rawContent: null,
    html: () => Promise.resolve(""),
    component: () => Promise.resolve(null),
    media: [],
    order: 2,
    depth: 1,
    isModule: false,
    modules: () => Promise.resolve([]),
    parent: () => Promise.resolve(null),
    children: () => Promise.resolve([]),
    siblings: () => Promise.resolve([]),
    summary: () => Promise.resolve(""),
  };

  const page = await loadPage(sib1, {
    storage,
    contentDir: "content",
    formats: makeFormats(),
    pages: [sib1, sib2, other],
    loadPage: makeLoadPage([sib2Page]),
    orphanProtection: false,
  });

  const siblings = await page.siblings();
  assertEquals(siblings.length, 1); // only sib2, not self or other-parent
  assertEquals(siblings[0].sourcePath, sib2.sourcePath);
});

// ---------------------------------------------------------------------------
// Tests — lazy parent()
// ---------------------------------------------------------------------------

Deno.test("parent(): resolves parent page from parentPath", async () => {
  const parentIndex = makeIndex({ sourcePath: "01.blog/default.md", route: "/blog", depth: 0, parentPath: null });
  const childIndex = makeIndex({ sourcePath: "01.blog/01.post/default.md", route: "/blog/post", depth: 1, parentPath: "01.blog" });

  const storage = makeStorage({ "content/01.blog/01.post/default.md": "---\ntitle: Post\n---\n" });

  const parentPage: Page = {
    sourcePath: parentIndex.sourcePath,
    route: parentIndex.route,
    language: "en",
    format: "md",
    template: "default",
    navTitle: "Blog",
    frontmatter: { title: "Blog", published: true, visible: true, taxonomy: {} } as PageFrontmatter,
    rawContent: null,
    html: () => Promise.resolve(""),
    component: () => Promise.resolve(null),
    media: [],
    order: 1,
    depth: 0,
    isModule: false,
    modules: () => Promise.resolve([]),
    parent: () => Promise.resolve(null),
    children: () => Promise.resolve([]),
    siblings: () => Promise.resolve([]),
    summary: () => Promise.resolve(""),
  };

  const page = await loadPage(childIndex, {
    storage,
    contentDir: "content",
    formats: makeFormats(),
    pages: [parentIndex, childIndex],
    loadPage: makeLoadPage([parentPage]),
    orphanProtection: false,
  });

  const parent = await page.parent();
  assertExists(parent);
  assertEquals(parent!.sourcePath, parentIndex.sourcePath);
});

Deno.test("parent(): returns null when no parentPath", async () => {
  const index = makeIndex({ sourcePath: "01.home/default.md", parentPath: null });
  const storage = makeStorage({ "content/01.home/default.md": "---\ntitle: Home\n---\n" });

  const page = await loadPage(index, {
    storage,
    contentDir: "content",
    formats: makeFormats(),
    pages: [index],
    loadPage: makeLoadPage([]),
    orphanProtection: false,
  });

  const parent = await page.parent();
  assertEquals(parent, null);
});

// ---------------------------------------------------------------------------
// Tests — lazy caching (lazyOnce)
// ---------------------------------------------------------------------------

Deno.test("html(): is cached — renderToHtml called only once", async () => {
  const index = makeIndex({ sourcePath: "01.home/default.md" });
  const storage = makeStorage({ "content/01.home/default.md": "---\ntitle: T\n---\nBody" });

  let callCount = 0;
  const registry = new FormatRegistry();
  registry.register({
    extensions: [".md"],
    extractFrontmatter: () => Promise.resolve({ title: "T", published: true, visible: true, taxonomy: {} } as PageFrontmatter),
    extractBody: () => "Body",
    renderToHtml: async () => {
      callCount++;
      await new Promise((r) => setTimeout(r, 1));
      return `<p>Body</p>`;
    },
  });

  const page = await loadPage(index, {
    storage,
    contentDir: "content",
    formats: registry,
    pages: [index],
    loadPage: makeLoadPage([]),
    orphanProtection: false,
  });

  await page.html();
  await page.html();
  await page.html();
  assertEquals(callCount, 1); // lazyOnce — only called once
});
