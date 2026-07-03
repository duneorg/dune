import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  resolveCollectionForPage,
  resolveCollectionsForPage,
} from "../../src/routing/collection-resolver.ts";
import { createCollectionEngine } from "../../src/collections/engine.ts";
import type { Page, PageIndex } from "../../src/content/types.ts";
import type { DuneEngine } from "../../src/core/engine.ts";

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

function makeFullPage(
  index: PageIndex,
  frontmatter: Record<string, unknown> = {},
): Page {
  return {
    sourcePath: index.sourcePath,
    route: index.route,
    language: index.language,
    format: index.format,
    template: index.template,
    navTitle: index.navTitle,
    frontmatter: { title: index.title, ...frontmatter },
    rawContent: null,
    html: () => Promise.resolve(""),
    component: () => Promise.resolve(null),
    handlers: () => Promise.resolve(null),
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

function makeFixture() {
  const home = makePage();
  const postA = makePage({
    sourcePath: "02.blog/01.a/post.md",
    route: "/blog/a",
    title: "A",
    parentPath: "02.blog",
    depth: 1,
    date: "2026-01-01",
  });
  const postB = makePage({
    sourcePath: "02.blog/02.b/post.md",
    route: "/blog/b",
    title: "B",
    parentPath: "02.blog",
    depth: 1,
    date: "2026-02-01",
  });
  const blog = makePage({
    sourcePath: "02.blog/default.md",
    route: "/blog",
    title: "Blog",
  });
  const talk = makePage({
    sourcePath: "03.talks/01.t/page.md",
    route: "/talks/t",
    title: "T",
    parentPath: "03.talks",
    depth: 1,
  });
  const talks = makePage({
    sourcePath: "03.talks/default.md",
    route: "/talks",
    title: "Talks",
  });
  const pages = [home, blog, postA, postB, talks, talk];
  const fullPages = new Map(pages.map((p) => [p.sourcePath, makeFullPage(p)]));
  const collections = createCollectionEngine({
    pages,
    taxonomyMap: {},
    loadPage: (sourcePath) => {
      const page = fullPages.get(sourcePath);
      return page ? Promise.resolve(page) : Promise.reject(new Error(`not found: ${sourcePath}`));
    },
  });
  const engine = { pages } as unknown as DuneEngine;
  return { home, pages, collections, engine };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test("resolveCollectionsForPage: resolves each named entry to a loaded collection", async () => {
  const { home, collections, engine } = makeFixture();
  const page = makeFullPage(home, {
    collections: {
      posts: {
        items: { "@page.children": "/blog" },
        order: { by: "date", dir: "desc" },
      },
      talks: {
        items: { "@page.children": "/talks" },
      },
    },
  });

  const result = await resolveCollectionsForPage(page, collections, engine);
  assertExists(result);
  assertEquals(Object.keys(result).sort(), ["posts", "talks"]);
  assertEquals(result.posts.items.map((p) => p.route), ["/blog/b", "/blog/a"]);
  assertEquals(result.talks.items.map((p) => p.route), ["/talks/t"]);
});

Deno.test("resolveCollectionsForPage: returns undefined without a collections map", async () => {
  const { home, collections, engine } = makeFixture();
  const page = makeFullPage(home);
  assertEquals(await resolveCollectionsForPage(page, collections, engine), undefined);
});

Deno.test("resolveCollectionsForPage: skips invalid entries, returns undefined when none resolve", async () => {
  const { home, collections, engine } = makeFixture();
  const page = makeFullPage(home, { collections: { bogus: "not-a-definition" } });
  assertEquals(await resolveCollectionsForPage(page, collections, engine), undefined);
});

Deno.test("resolveCollectionForPage: single `collection:` frontmatter still resolves", async () => {
  const { home, collections, engine } = makeFixture();
  const page = makeFullPage(home, {
    collection: { items: { "@page.children": "/blog" } },
  });
  const result = await resolveCollectionForPage(page, collections, engine);
  assertExists(result);
  assertEquals(result.items.length, 2);
});
