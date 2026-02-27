import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createCollectionEngine,
} from "../../src/collections/engine.ts";
import type { Page, PageIndex } from "../../src/content/types.ts";
import type { TaxonomyMap } from "../../src/content/index-builder.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePage(overrides: Partial<PageIndex> = {}): PageIndex {
  return {
    sourcePath: "01.home/default.md",
    route: "/home",
    language: "en",
    format: "md",
    template: "default",
    title: "Home",
    navTitle: "Home",
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
    mtime: Date.now(),
    hash: "abc",
    ...overrides,
  };
}

/**
 * Minimal Page stub — only the fields the collection engine itself touches
 * (sourcePath is the key used by loadPage and Collection.items).
 */
function makeFullPage(index: PageIndex): Page {
  return {
    sourcePath: index.sourcePath,
    route: index.route,
    language: index.language,
    format: index.format,
    template: index.template,
    navTitle: index.navTitle,
    frontmatter: { title: index.title },
    rawContent: null,
    html: () => Promise.resolve(""),
    component: () => Promise.resolve(null),
    media: [],
    order: index.order,
    depth: index.depth,
    isModule: index.isModule,
    modules: () => Promise.resolve([]),
    parent: () => Promise.resolve(null),
    children: () => Promise.resolve([]),
    siblings: () => Promise.resolve([]),
    summary: () => Promise.resolve(""),
  };
}

/** Build a loadPage stub that resolves a Page from the supplied index list. */
function makeLoadPage(pages: PageIndex[]): (sourcePath: string) => Promise<Page> {
  const map = new Map<string, Page>(pages.map((p) => [p.sourcePath, makeFullPage(p)]));
  return (sourcePath: string) => {
    const page = map.get(sourcePath);
    if (!page) return Promise.reject(new Error(`loadPage: not found: ${sourcePath}`));
    return Promise.resolve(page);
  };
}

// ---------------------------------------------------------------------------
// Tests — resolveSource: @self.children
// ---------------------------------------------------------------------------

Deno.test("resolveSource @self.children: returns direct child pages", async () => {
  const parent = makePage({
    sourcePath: "02.blog/default.md",
    route: "/blog",
    parentPath: null,
  });
  const child1 = makePage({
    sourcePath: "02.blog/01.post-a/default.md",
    route: "/blog/post-a",
    parentPath: "/blog",
  });
  const child2 = makePage({
    sourcePath: "02.blog/02.post-b/default.md",
    route: "/blog/post-b",
    parentPath: "/blog",
  });
  // grandchild — should NOT be returned by @self.children
  const grandchild = makePage({
    sourcePath: "02.blog/01.post-a/01.nested/default.md",
    route: "/blog/post-a/nested",
    parentPath: "/blog/post-a",
  });

  const allPages = [parent, child1, child2, grandchild];
  const engine = createCollectionEngine({
    pages: allPages,
    taxonomyMap: {},
    loadPage: makeLoadPage(allPages),
  });

  const collection = await engine.resolve(
    { items: { "@self.children": true } },
    parent,
  );
  await collection.load();

  assertEquals(collection.items.length, 2);
  const routes = collection.items.map((p) => p.route).sort();
  assertEquals(routes, ["/blog/post-a", "/blog/post-b"]);
});

Deno.test("resolveSource @self.children: excludes module pages", async () => {
  const parent = makePage({ sourcePath: "02.blog/default.md", route: "/blog" });
  const child = makePage({
    sourcePath: "02.blog/01.post/default.md",
    route: "/blog/post",
    isModule: false,
  });
  const module_ = makePage({
    sourcePath: "02.blog/_hero/default.md",
    route: "/blog/_hero",
    isModule: true,
  });

  const allPages = [parent, child, module_];
  const engine = createCollectionEngine({
    pages: allPages,
    taxonomyMap: {},
    loadPage: makeLoadPage(allPages),
  });

  const collection = await engine.resolve(
    { items: { "@self.children": true } },
    parent,
  );
  await collection.load();

  assertEquals(collection.items.length, 1);
  assertEquals(collection.items[0].route, "/blog/post");
});

// ---------------------------------------------------------------------------
// Tests — resolveSource: @self.siblings
// ---------------------------------------------------------------------------

Deno.test("resolveSource @self.siblings: returns pages with same parentPath", async () => {
  const sibling1 = makePage({
    sourcePath: "02.blog/01.post-a/default.md",
    route: "/blog/post-a",
    parentPath: "/blog",
  });
  const sibling2 = makePage({
    sourcePath: "02.blog/02.post-b/default.md",
    route: "/blog/post-b",
    parentPath: "/blog",
  });
  const unrelated = makePage({
    sourcePath: "03.news/01.article/default.md",
    route: "/news/article",
    parentPath: "/news",
  });

  const allPages = [sibling1, sibling2, unrelated];
  const engine = createCollectionEngine({
    pages: allPages,
    taxonomyMap: {},
    loadPage: makeLoadPage(allPages),
  });

  const collection = await engine.resolve(
    { items: { "@self.siblings": true } },
    sibling1,
  );
  await collection.load();

  assertEquals(collection.items.length, 1);
  assertEquals(collection.items[0].route, "/blog/post-b");
});

Deno.test("resolveSource @self.siblings: returns empty when parentPath is null", async () => {
  const rootPage = makePage({ sourcePath: "01.home/default.md", route: "/home", parentPath: null });
  const allPages = [rootPage];
  const engine = createCollectionEngine({
    pages: allPages,
    taxonomyMap: {},
    loadPage: makeLoadPage(allPages),
  });

  const collection = await engine.resolve(
    { items: { "@self.siblings": true } },
    rootPage,
  );
  await collection.load();

  assertEquals(collection.items.length, 0);
});

// ---------------------------------------------------------------------------
// Tests — resolveSource: @self.descendants
// ---------------------------------------------------------------------------

Deno.test("resolveSource @self.descendants: returns all nested pages", async () => {
  const parent = makePage({ sourcePath: "02.blog/default.md", route: "/blog" });
  const child = makePage({
    sourcePath: "02.blog/01.post/default.md",
    route: "/blog/post",
  });
  const grandchild = makePage({
    sourcePath: "02.blog/01.post/01.deep/default.md",
    route: "/blog/post/deep",
  });
  const unrelated = makePage({
    sourcePath: "03.about/default.md",
    route: "/about",
  });

  const allPages = [parent, child, grandchild, unrelated];
  const engine = createCollectionEngine({
    pages: allPages,
    taxonomyMap: {},
    loadPage: makeLoadPage(allPages),
  });

  const collection = await engine.resolve(
    { items: { "@self.descendants": true } },
    parent,
  );
  await collection.load();

  assertEquals(collection.items.length, 2);
  const routes = collection.items.map((p) => p.route).sort();
  assertEquals(routes, ["/blog/post", "/blog/post/deep"]);
});

// ---------------------------------------------------------------------------
// Tests — resolveSource: @taxonomy.tag
// ---------------------------------------------------------------------------

Deno.test("resolveSource @taxonomy.tag: finds pages by single tag", async () => {
  const post1 = makePage({
    sourcePath: "02.blog/01.post-a/default.md",
    route: "/blog/post-a",
    taxonomy: { tag: ["deno", "typescript"] },
  });
  const post2 = makePage({
    sourcePath: "02.blog/02.post-b/default.md",
    route: "/blog/post-b",
    taxonomy: { tag: ["javascript"] },
  });

  const taxonomyMap: TaxonomyMap = {
    tag: {
      deno: ["02.blog/01.post-a/default.md"],
      typescript: ["02.blog/01.post-a/default.md"],
      javascript: ["02.blog/02.post-b/default.md"],
    },
  };

  const allPages = [post1, post2];
  const engine = createCollectionEngine({
    pages: allPages,
    taxonomyMap,
    loadPage: makeLoadPage(allPages),
  });

  const contextPage = makePage({ sourcePath: "01.home/default.md" });
  const collection = await engine.resolve(
    { items: { "@taxonomy.tag": "deno" } },
    contextPage,
  );
  await collection.load();

  assertEquals(collection.items.length, 1);
  assertEquals(collection.items[0].route, "/blog/post-a");
});

Deno.test("resolveSource @taxonomy.tag: union of multiple tag values", async () => {
  const post1 = makePage({
    sourcePath: "02.blog/01.post-a/default.md",
    route: "/blog/post-a",
  });
  const post2 = makePage({
    sourcePath: "02.blog/02.post-b/default.md",
    route: "/blog/post-b",
  });
  const post3 = makePage({
    sourcePath: "02.blog/03.post-c/default.md",
    route: "/blog/post-c",
  });

  const taxonomyMap: TaxonomyMap = {
    tag: {
      deno: ["02.blog/01.post-a/default.md"],
      typescript: ["02.blog/02.post-b/default.md"],
      javascript: ["02.blog/03.post-c/default.md"],
    },
  };

  const allPages = [post1, post2, post3];
  const engine = createCollectionEngine({
    pages: allPages,
    taxonomyMap,
    loadPage: makeLoadPage(allPages),
  });

  const contextPage = makePage({ sourcePath: "01.home/default.md" });
  const collection = await engine.resolve(
    { items: { "@taxonomy.tag": ["deno", "typescript"] } },
    contextPage,
  );
  await collection.load();

  assertEquals(collection.items.length, 2);
  const routes = collection.items.map((p) => p.route).sort();
  assertEquals(routes, ["/blog/post-a", "/blog/post-b"]);
});

// ---------------------------------------------------------------------------
// Tests — resolveSource: @taxonomy (multi-criteria AND intersection)
// ---------------------------------------------------------------------------

Deno.test("resolveSource @taxonomy multi: AND intersection of taxonomy criteria", async () => {
  const post1 = makePage({
    sourcePath: "02.blog/01.post-a/default.md",
    route: "/blog/post-a",
  });
  const post2 = makePage({
    sourcePath: "02.blog/02.post-b/default.md",
    route: "/blog/post-b",
  });
  // post1 has both tag=deno AND category=tutorial; post2 only has tag=deno
  const taxonomyMap: TaxonomyMap = {
    tag: {
      deno: [
        "02.blog/01.post-a/default.md",
        "02.blog/02.post-b/default.md",
      ],
    },
    category: {
      tutorial: ["02.blog/01.post-a/default.md"],
    },
  };

  const allPages = [post1, post2];
  const engine = createCollectionEngine({
    pages: allPages,
    taxonomyMap,
    loadPage: makeLoadPage(allPages),
  });

  const contextPage = makePage({ sourcePath: "01.home/default.md" });
  const collection = await engine.resolve(
    { items: { "@taxonomy": { tag: "deno", category: "tutorial" } } },
    contextPage,
  );
  await collection.load();

  assertEquals(collection.items.length, 1);
  assertEquals(collection.items[0].route, "/blog/post-a");
});

Deno.test("resolveSource @taxonomy multi: returns empty when no intersection", async () => {
  const post1 = makePage({ sourcePath: "02.blog/01.post-a/default.md", route: "/blog/post-a" });
  const post2 = makePage({ sourcePath: "02.blog/02.post-b/default.md", route: "/blog/post-b" });

  const taxonomyMap: TaxonomyMap = {
    tag: { deno: ["02.blog/01.post-a/default.md"] },
    category: { tutorial: ["02.blog/02.post-b/default.md"] },
  };

  const allPages = [post1, post2];
  const engine = createCollectionEngine({
    pages: allPages,
    taxonomyMap,
    loadPage: makeLoadPage(allPages),
  });

  const contextPage = makePage({ sourcePath: "01.home/default.md" });
  const collection = await engine.resolve(
    { items: { "@taxonomy": { tag: "deno", category: "tutorial" } } },
    contextPage,
  );
  await collection.load();

  assertEquals(collection.items.length, 0);
});

// ---------------------------------------------------------------------------
// Tests — applyFilter
// ---------------------------------------------------------------------------

Deno.test("applyFilter: unpublished pages are excluded by default", async () => {
  const published = makePage({
    sourcePath: "02.blog/01.post/default.md",
    route: "/blog/post",
    published: true,
    parentPath: "/blog",
  });
  const draft = makePage({
    sourcePath: "02.blog/02.draft/default.md",
    route: "/blog/draft",
    published: false,
    parentPath: "/blog",
  });

  const parent = makePage({ sourcePath: "02.blog/default.md", route: "/blog" });
  const allPages = [parent, published, draft];
  const engine = createCollectionEngine({
    pages: allPages,
    taxonomyMap: {},
    loadPage: makeLoadPage(allPages),
  });

  const collection = await engine.resolve(
    { items: { "@self.children": true } },
    parent,
  );
  await collection.load();

  assertEquals(collection.items.length, 1);
  assertEquals(collection.items[0].route, "/blog/post");
});

Deno.test("applyFilter: visible filter removes invisible pages", async () => {
  const visible = makePage({
    sourcePath: "02.blog/01.post/default.md",
    route: "/blog/post",
    visible: true,
    parentPath: "/blog",
  });
  const hidden = makePage({
    sourcePath: "02.blog/02.hidden/default.md",
    route: "/blog/hidden",
    visible: false,
    parentPath: "/blog",
  });

  const parent = makePage({ sourcePath: "02.blog/default.md", route: "/blog" });
  const allPages = [parent, visible, hidden];
  const engine = createCollectionEngine({
    pages: allPages,
    taxonomyMap: {},
    loadPage: makeLoadPage(allPages),
  });

  const collection = await engine.resolve(
    {
      items: { "@self.children": true },
      filter: { visible: true },
    },
    parent,
  );
  await collection.load();

  assertEquals(collection.items.length, 1);
  assertEquals(collection.items[0].route, "/blog/post");
});

Deno.test("applyFilter: template filter restricts to matching template(s)", async () => {
  const post = makePage({
    sourcePath: "02.blog/01.post/default.md",
    route: "/blog/post",
    template: "post",
    parentPath: "/blog",
  });
  const landing = makePage({
    sourcePath: "02.blog/02.landing/default.md",
    route: "/blog/landing",
    template: "landing",
    parentPath: "/blog",
  });

  const parent = makePage({ sourcePath: "02.blog/default.md", route: "/blog" });
  const allPages = [parent, post, landing];
  const engine = createCollectionEngine({
    pages: allPages,
    taxonomyMap: {},
    loadPage: makeLoadPage(allPages),
  });

  const collection = await engine.resolve(
    {
      items: { "@self.children": true },
      filter: { template: "post" },
    },
    parent,
  );
  await collection.load();

  assertEquals(collection.items.length, 1);
  assertEquals(collection.items[0].route, "/blog/post");
});

Deno.test("applyFilter: taxonomy filter keeps pages matching at least one value", async () => {
  const denoPost = makePage({
    sourcePath: "02.blog/01.deno/default.md",
    route: "/blog/deno",
    taxonomy: { tag: ["deno"] },
    parentPath: "/blog",
  });
  const jsPost = makePage({
    sourcePath: "02.blog/02.js/default.md",
    route: "/blog/js",
    taxonomy: { tag: ["javascript"] },
    parentPath: "/blog",
  });

  const parent = makePage({ sourcePath: "02.blog/default.md", route: "/blog" });
  const allPages = [parent, denoPost, jsPost];
  const engine = createCollectionEngine({
    pages: allPages,
    taxonomyMap: {},
    loadPage: makeLoadPage(allPages),
  });

  const collection = await engine.resolve(
    {
      items: { "@self.children": true },
      filter: { taxonomy: { tag: ["deno", "typescript"] } },
    },
    parent,
  );
  await collection.load();

  assertEquals(collection.items.length, 1);
  assertEquals(collection.items[0].route, "/blog/deno");
});

// ---------------------------------------------------------------------------
// Tests — applyOrder
// ---------------------------------------------------------------------------

Deno.test("applyOrder: date desc puts most recent first", async () => {
  const old = makePage({
    sourcePath: "02.blog/01.old/default.md",
    route: "/blog/old",
    date: "2023-01-01",
    parentPath: "/blog",
  });
  const recent = makePage({
    sourcePath: "02.blog/02.recent/default.md",
    route: "/blog/recent",
    date: "2024-06-01",
    parentPath: "/blog",
  });

  const parent = makePage({ sourcePath: "02.blog/default.md", route: "/blog" });
  const allPages = [parent, old, recent];
  const engine = createCollectionEngine({
    pages: allPages,
    taxonomyMap: {},
    loadPage: makeLoadPage(allPages),
  });

  const collection = await engine.resolve(
    {
      items: { "@self.children": true },
      order: { by: "date", dir: "desc" },
    },
    parent,
  );
  await collection.load();

  assertEquals(collection.items[0].route, "/blog/recent");
  assertEquals(collection.items[1].route, "/blog/old");
});

Deno.test("applyOrder: date asc puts oldest first", async () => {
  const old = makePage({
    sourcePath: "02.blog/01.old/default.md",
    route: "/blog/old",
    date: "2023-01-01",
    parentPath: "/blog",
  });
  const recent = makePage({
    sourcePath: "02.blog/02.recent/default.md",
    route: "/blog/recent",
    date: "2024-06-01",
    parentPath: "/blog",
  });

  const parent = makePage({ sourcePath: "02.blog/default.md", route: "/blog" });
  const allPages = [parent, old, recent];
  const engine = createCollectionEngine({
    pages: allPages,
    taxonomyMap: {},
    loadPage: makeLoadPage(allPages),
  });

  const collection = await engine.resolve(
    {
      items: { "@self.children": true },
      order: { by: "date", dir: "asc" },
    },
    parent,
  );
  await collection.load();

  assertEquals(collection.items[0].route, "/blog/old");
  assertEquals(collection.items[1].route, "/blog/recent");
});

Deno.test("applyOrder: title asc sorts alphabetically", async () => {
  const charlie = makePage({
    sourcePath: "02.blog/01.c/default.md",
    route: "/blog/c",
    title: "Charlie",
    parentPath: "/blog",
  });
  const alice = makePage({
    sourcePath: "02.blog/02.a/default.md",
    route: "/blog/a",
    title: "Alice",
    parentPath: "/blog",
  });
  const bob = makePage({
    sourcePath: "02.blog/03.b/default.md",
    route: "/blog/b",
    title: "Bob",
    parentPath: "/blog",
  });

  const parent = makePage({ sourcePath: "02.blog/default.md", route: "/blog" });
  const allPages = [parent, charlie, alice, bob];
  const engine = createCollectionEngine({
    pages: allPages,
    taxonomyMap: {},
    loadPage: makeLoadPage(allPages),
  });

  const collection = await engine.resolve(
    {
      items: { "@self.children": true },
      order: { by: "title", dir: "asc" },
    },
    parent,
  );
  await collection.load();

  assertEquals(collection.items[0].route, "/blog/a");
  assertEquals(collection.items[1].route, "/blog/b");
  assertEquals(collection.items[2].route, "/blog/c");
});

Deno.test("applyOrder: order field sorts by numeric order property", async () => {
  const third = makePage({
    sourcePath: "02.blog/03.third/default.md",
    route: "/blog/third",
    order: 3,
    parentPath: "/blog",
  });
  const first = makePage({
    sourcePath: "02.blog/01.first/default.md",
    route: "/blog/first",
    order: 1,
    parentPath: "/blog",
  });
  const second = makePage({
    sourcePath: "02.blog/02.second/default.md",
    route: "/blog/second",
    order: 2,
    parentPath: "/blog",
  });

  const parent = makePage({ sourcePath: "02.blog/default.md", route: "/blog" });
  const allPages = [parent, third, first, second];
  const engine = createCollectionEngine({
    pages: allPages,
    taxonomyMap: {},
    loadPage: makeLoadPage(allPages),
  });

  const collection = await engine.resolve(
    {
      items: { "@self.children": true },
      order: { by: "order", dir: "asc" },
    },
    parent,
  );
  await collection.load();

  assertEquals(collection.items[0].route, "/blog/first");
  assertEquals(collection.items[1].route, "/blog/second");
  assertEquals(collection.items[2].route, "/blog/third");
});

// ---------------------------------------------------------------------------
// Tests — pagination
// ---------------------------------------------------------------------------

Deno.test("pagination: limit restricts item count, total reflects full set", async () => {
  const parent = makePage({ sourcePath: "02.blog/default.md", route: "/blog" });
  const children = Array.from({ length: 5 }, (_, i) =>
    makePage({
      sourcePath: `02.blog/0${i + 1}.post/default.md`,
      route: `/blog/post-${i + 1}`,
      parentPath: "/blog",
      order: i + 1,
    })
  );

  const allPages = [parent, ...children];
  const engine = createCollectionEngine({
    pages: allPages,
    taxonomyMap: {},
    loadPage: makeLoadPage(allPages),
  });

  const collection = await engine.resolve(
    {
      items: { "@self.children": true },
      limit: 3,
      order: { by: "order", dir: "asc" },
    },
    parent,
  );
  await collection.load();

  assertEquals(collection.items.length, 3);
  assertEquals(collection.total, 5);
});

Deno.test("pagination: offset skips leading items", async () => {
  const parent = makePage({ sourcePath: "02.blog/default.md", route: "/blog" });
  const children = Array.from({ length: 4 }, (_, i) =>
    makePage({
      sourcePath: `02.blog/0${i + 1}.post/default.md`,
      route: `/blog/post-${i + 1}`,
      parentPath: "/blog",
      order: i + 1,
    })
  );

  const allPages = [parent, ...children];
  const engine = createCollectionEngine({
    pages: allPages,
    taxonomyMap: {},
    loadPage: makeLoadPage(allPages),
  });

  const collection = await engine.resolve(
    {
      items: { "@self.children": true },
      offset: 2,
      order: { by: "order", dir: "asc" },
    },
    parent,
  );
  await collection.load();

  assertEquals(collection.items.length, 2);
  assertEquals(collection.items[0].route, "/blog/post-3");
  assertEquals(collection.items[1].route, "/blog/post-4");
});

Deno.test("pagination: pagination object sets page/pages/hasNext/hasPrev", async () => {
  const parent = makePage({ sourcePath: "02.blog/default.md", route: "/blog" });
  const children = Array.from({ length: 10 }, (_, i) =>
    makePage({
      sourcePath: `02.blog/${String(i + 1).padStart(2, "0")}.post/default.md`,
      route: `/blog/post-${i + 1}`,
      parentPath: "/blog",
      order: i + 1,
    })
  );

  const allPages = [parent, ...children];
  const engine = createCollectionEngine({
    pages: allPages,
    taxonomyMap: {},
    loadPage: makeLoadPage(allPages),
  });

  // Request page 2 of 3 (page size=4, offset=4)
  const collection = await engine.resolve(
    {
      items: { "@self.children": true },
      order: { by: "order", dir: "asc" },
      offset: 4,
      limit: 4,
      pagination: { size: 4 },
    },
    parent,
  );
  await collection.load();

  assertEquals(collection.items.length, 4);
  assertEquals(collection.total, 10);
  assertEquals(collection.page, 2);
  assertEquals(collection.pages, 3);
  assertEquals(collection.hasNext, true);
  assertEquals(collection.hasPrev, true);
});

Deno.test("pagination: first page has hasPrev false", async () => {
  const parent = makePage({ sourcePath: "02.blog/default.md", route: "/blog" });
  const children = Array.from({ length: 6 }, (_, i) =>
    makePage({
      sourcePath: `02.blog/0${i + 1}.post/default.md`,
      route: `/blog/post-${i + 1}`,
      parentPath: "/blog",
      order: i + 1,
    })
  );

  const allPages = [parent, ...children];
  const engine = createCollectionEngine({
    pages: allPages,
    taxonomyMap: {},
    loadPage: makeLoadPage(allPages),
  });

  const collection = await engine.resolve(
    {
      items: { "@self.children": true },
      order: { by: "order", dir: "asc" },
      offset: 0,
      limit: 3,
      pagination: { size: 3 },
    },
    parent,
  );

  assertEquals(collection.page, 1);
  assertEquals(collection.hasPrev, false);
  assertEquals(collection.hasNext, true);
});

// ---------------------------------------------------------------------------
// Tests — Collection chainable modifiers
// ---------------------------------------------------------------------------

Deno.test("collection.slice: returns a subset of index items", async () => {
  const parent = makePage({ sourcePath: "02.blog/default.md", route: "/blog" });
  const children = Array.from({ length: 5 }, (_, i) =>
    makePage({
      sourcePath: `02.blog/0${i + 1}.post/default.md`,
      route: `/blog/post-${i + 1}`,
      parentPath: "/blog",
      order: i + 1,
    })
  );

  const allPages = [parent, ...children];
  const engine = createCollectionEngine({
    pages: allPages,
    taxonomyMap: {},
    loadPage: makeLoadPage(allPages),
  });

  const collection = await engine.resolve(
    {
      items: { "@self.children": true },
      order: { by: "order", dir: "asc" },
    },
    parent,
  );

  const sliced = collection.slice(1, 3);
  await sliced.load();

  assertEquals(sliced.items.length, 2);
  assertEquals(sliced.total, 2);
  assertEquals(sliced.items[0].route, "/blog/post-2");
  assertEquals(sliced.items[1].route, "/blog/post-3");
});

Deno.test("collection.paginate: returns correct page and pagination state", async () => {
  const parent = makePage({ sourcePath: "02.blog/default.md", route: "/blog" });
  const children = Array.from({ length: 9 }, (_, i) =>
    makePage({
      sourcePath: `02.blog/0${i + 1}.post/default.md`,
      route: `/blog/post-${i + 1}`,
      parentPath: "/blog",
      order: i + 1,
    })
  );

  const allPages = [parent, ...children];
  const engine = createCollectionEngine({
    pages: allPages,
    taxonomyMap: {},
    loadPage: makeLoadPage(allPages),
  });

  const base = await engine.resolve(
    {
      items: { "@self.children": true },
      order: { by: "order", dir: "asc" },
    },
    parent,
  );

  const page2 = base.paginate(3, 2);
  await page2.load();

  assertEquals(page2.items.length, 3);
  assertEquals(page2.total, 9);
  assertEquals(page2.page, 2);
  assertEquals(page2.pages, 3);
  assertEquals(page2.hasNext, true);
  assertEquals(page2.hasPrev, true);
  assertEquals(page2.items[0].route, "/blog/post-4");
});

Deno.test("collection.order: re-sorts items by title asc", async () => {
  const parent = makePage({ sourcePath: "02.blog/default.md", route: "/blog" });
  const z = makePage({
    sourcePath: "02.blog/01.z/default.md",
    route: "/blog/z",
    title: "Zebra",
    parentPath: "/blog",
  });
  const a = makePage({
    sourcePath: "02.blog/02.a/default.md",
    route: "/blog/a",
    title: "Aardvark",
    parentPath: "/blog",
  });

  const allPages = [parent, z, a];
  const engine = createCollectionEngine({
    pages: allPages,
    taxonomyMap: {},
    loadPage: makeLoadPage(allPages),
  });

  const base = await engine.resolve(
    { items: { "@self.children": true } },
    parent,
  );

  const sorted = base.order("title", "asc");
  await sorted.load();

  assertEquals(sorted.items[0].route, "/blog/a");
  assertEquals(sorted.items[1].route, "/blog/z");
});

// ---------------------------------------------------------------------------
// Tests — rebuild()
// ---------------------------------------------------------------------------

Deno.test("rebuild: swaps internal pages and taxonomyMap", async () => {
  const post1 = makePage({
    sourcePath: "02.blog/01.post-a/default.md",
    route: "/blog/post-a",
    taxonomy: { tag: ["deno"] },
  });

  const engine = createCollectionEngine({
    pages: [post1],
    taxonomyMap: { tag: { deno: ["02.blog/01.post-a/default.md"] } },
    loadPage: makeLoadPage([post1]),
  });

  const contextPage = makePage({ sourcePath: "01.home/default.md" });
  const before = await engine.resolve(
    { items: { "@taxonomy.tag": "deno" } },
    contextPage,
  );
  await before.load();
  assertEquals(before.items.length, 1);

  // Rebuild with new data — post1 removed, post2 added
  const post2 = makePage({
    sourcePath: "02.blog/02.post-b/default.md",
    route: "/blog/post-b",
    taxonomy: { tag: ["typescript"] },
  });
  engine.rebuild(
    [post2],
    { tag: { typescript: ["02.blog/02.post-b/default.md"] } },
  );

  // Re-resolve a new loadPage for the new page set
  const newLoadPage = makeLoadPage([post2]);
  const engine2 = createCollectionEngine({
    pages: [post2],
    taxonomyMap: { tag: { typescript: ["02.blog/02.post-b/default.md"] } },
    loadPage: newLoadPage,
  });

  const afterDeno = await engine2.resolve(
    { items: { "@taxonomy.tag": "deno" } },
    contextPage,
  );
  await afterDeno.load();
  assertEquals(afterDeno.items.length, 0);

  const afterTs = await engine2.resolve(
    { items: { "@taxonomy.tag": "typescript" } },
    contextPage,
  );
  await afterTs.load();
  assertEquals(afterTs.items.length, 1);
  assertEquals(afterTs.items[0].route, "/blog/post-b");
});

// ---------------------------------------------------------------------------
// Tests — engine.query (no context page)
// ---------------------------------------------------------------------------

Deno.test("engine.query: resolves taxonomy source without context page", async () => {
  const post = makePage({
    sourcePath: "02.blog/01.post/default.md",
    route: "/blog/post",
    taxonomy: { tag: ["deno"] },
  });

  const taxonomyMap: TaxonomyMap = {
    tag: { deno: ["02.blog/01.post/default.md"] },
  };

  const allPages = [post];
  const engine = createCollectionEngine({
    pages: allPages,
    taxonomyMap,
    loadPage: makeLoadPage(allPages),
  });

  const collection = await engine.query({
    items: { "@taxonomy.tag": "deno" },
  });
  await collection.load();

  assertEquals(collection.items.length, 1);
  assertEquals(collection.items[0].route, "/blog/post");
});

// ---------------------------------------------------------------------------
// Tests — @page.children and @page.descendants
// ---------------------------------------------------------------------------

Deno.test("resolveSource @page.children: fetches children of named route", async () => {
  const blog = makePage({ sourcePath: "02.blog/default.md", route: "/blog" });
  const child = makePage({
    sourcePath: "02.blog/01.post/default.md",
    route: "/blog/post",
  });
  const unrelated = makePage({
    sourcePath: "03.about/default.md",
    route: "/about",
  });

  const allPages = [blog, child, unrelated];
  const engine = createCollectionEngine({
    pages: allPages,
    taxonomyMap: {},
    loadPage: makeLoadPage(allPages),
  });

  const contextPage = makePage({ sourcePath: "01.home/default.md", route: "/home" });
  const collection = await engine.resolve(
    { items: { "@page.children": "/blog" } },
    contextPage,
  );
  await collection.load();

  assertEquals(collection.items.length, 1);
  assertEquals(collection.items[0].route, "/blog/post");
});

Deno.test("resolveSource @page.children: returns empty for unknown route", async () => {
  const allPages = [makePage({ sourcePath: "01.home/default.md", route: "/home" })];
  const engine = createCollectionEngine({
    pages: allPages,
    taxonomyMap: {},
    loadPage: makeLoadPage(allPages),
  });

  const contextPage = makePage({ sourcePath: "01.home/default.md" });
  const collection = await engine.resolve(
    { items: { "@page.children": "/does-not-exist" } },
    contextPage,
  );
  await collection.load();

  assertEquals(collection.items.length, 0);
});

Deno.test("resolveSource @page.descendants: fetches all nested pages of named route", async () => {
  const blog = makePage({ sourcePath: "02.blog/default.md", route: "/blog" });
  const child = makePage({
    sourcePath: "02.blog/01.post/default.md",
    route: "/blog/post",
  });
  const grandchild = makePage({
    sourcePath: "02.blog/01.post/01.deep/default.md",
    route: "/blog/post/deep",
  });

  const allPages = [blog, child, grandchild];
  const engine = createCollectionEngine({
    pages: allPages,
    taxonomyMap: {},
    loadPage: makeLoadPage(allPages),
  });

  const contextPage = makePage({ sourcePath: "01.home/default.md", route: "/home" });
  const collection = await engine.resolve(
    { items: { "@page.descendants": "/blog" } },
    contextPage,
  );
  await collection.load();

  assertEquals(collection.items.length, 2);
  const routes = collection.items.map((p) => p.route).sort();
  assertEquals(routes, ["/blog/post", "/blog/post/deep"]);
});

// ---------------------------------------------------------------------------
// Tests — collection metadata
// ---------------------------------------------------------------------------

Deno.test("collection: total reflects full unsliced result set", async () => {
  const parent = makePage({ sourcePath: "02.blog/default.md", route: "/blog" });
  const children = Array.from({ length: 8 }, (_, i) =>
    makePage({
      sourcePath: `02.blog/0${i + 1}.post/default.md`,
      route: `/blog/post-${i + 1}`,
      parentPath: "/blog",
      order: i + 1,
    })
  );

  const allPages = [parent, ...children];
  const engine = createCollectionEngine({
    pages: allPages,
    taxonomyMap: {},
    loadPage: makeLoadPage(allPages),
  });

  const collection = await engine.resolve(
    {
      items: { "@self.children": true },
      limit: 3,
    },
    parent,
  );

  assertEquals(collection.total, 8);
  assertEquals(collection.items.length, 0); // not loaded yet — synchronous getter
  await collection.load();
  assertEquals(collection.items.length, 3);
});

Deno.test("collection: assertExists confirms collection object is returned", async () => {
  const parent = makePage({ sourcePath: "02.blog/default.md", route: "/blog" });
  const allPages = [parent];
  const engine = createCollectionEngine({
    pages: allPages,
    taxonomyMap: {},
    loadPage: makeLoadPage(allPages),
  });

  const collection = await engine.resolve(
    { items: { "@self.children": true } },
    parent,
  );

  assertExists(collection);
  assertExists(collection.load);
  assertExists(collection.slice);
  assertExists(collection.paginate);
  assertExists(collection.order);
  assertExists(collection.filter);
});

Deno.test("collection: empty source produces total=0 and empty items", async () => {
  const parent = makePage({ sourcePath: "02.blog/default.md", route: "/blog" });
  const allPages = [parent];
  const engine = createCollectionEngine({
    pages: allPages,
    taxonomyMap: {},
    loadPage: makeLoadPage(allPages),
  });

  const collection = await engine.resolve(
    { items: { "@self.children": true } },
    parent,
  );
  await collection.load();

  assertEquals(collection.total, 0);
  assertEquals(collection.items.length, 0);
  assertEquals(collection.hasNext, false);
  assertEquals(collection.hasPrev, false);
});
