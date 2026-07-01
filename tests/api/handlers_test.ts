/**
 * Tests for the public API handler (src/api/handlers.ts, createApiHandler).
 *
 * This is the shared handler used by the framework's Fresh app (and the docs
 * site). It replaced the legacy duneRoutes.apiHandler, whose tests previously
 * lived in tests/routing/routes_test.ts.
 */

import { assertEquals, assertExists } from "@std/assert";
import { createApiHandler } from "../../src/api/handlers.ts";
import { createTaxonomyEngine } from "../../src/taxonomy/engine.ts";
import { createCollectionEngine } from "../../src/collections/engine.ts";
import type { DuneEngine, ResolveResult } from "../../src/core/engine.ts";
import type { SearchEngine } from "../../src/search/engine.ts";
import type { Page, PageIndex } from "../../src/content/types.ts";
import type { DuneConfig, SiteConfig } from "../../src/config/types.ts";
import type { TaxonomyMap } from "../../src/content/index-builder.ts";

// ── Stubs ──────────────────────────────────────────────────────────────────

function makePageIndex(overrides: Partial<PageIndex> = {}): PageIndex {
  return {
    sourcePath: "01.home/default.md",
    route: "/",
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

function makeFullPage(overrides: Partial<Page> = {}): Page {
  return {
    sourcePath: "02.blog/01.hello/default.md",
    route: "/blog/hello",
    language: "en",
    format: "md",
    template: "post",
    navTitle: "Hello",
    frontmatter: { title: "Hello World", date: "2024-01-15" },
    rawContent: null,
    html: () => Promise.resolve("<h1>Hello World</h1>"),
    component: () => Promise.resolve(null),
    handlers: () => Promise.resolve(null),
    media: [],
    order: 1,
    depth: 1,
    isModule: false,
    modules: () => Promise.resolve([]),
    parent: () => Promise.resolve(null),
    children: () => Promise.resolve([]),
    siblings: () => Promise.resolve([]),
    summary: () => Promise.resolve(""),
    ...overrides,
  };
}

const stubSite: SiteConfig = {
  title: "Test Site",
  description: "Test",
  url: "https://example.com",
  author: { name: "Test Author" },
  metadata: {},
  taxonomies: ["tag"],
  routes: {},
  redirects: {},
  cors_origins: [],
};

const stubConfig: DuneConfig = {
  site: stubSite,
  system: {
    content: {
      dir: "content",
      markdown: { extra: false, auto_links: false, auto_url_links: false },
    },
    cache: { enabled: false, driver: "memory", lifetime: 0, check: "none" },
    images: { default_quality: 80, cache_dir: ".cache", allowed_sizes: [] },
    languages: { supported: ["en"], default: "en", include_default_in_url: false },
    debug: false,
    timezone: "UTC",
  },
  theme: { name: "default", custom: {} },
  plugins: {},
  pluginList: [],
};

function makeEngine(
  pages: PageIndex[],
  taxonomyMap: TaxonomyMap = {},
  resolveOverride?: (route: string) => Promise<ResolveResult>,
): DuneEngine {
  return {
    config: stubConfig,
    site: stubSite,
    pages,
    blueprints: {},
    taxonomyMap,
    router: {
      getNavigation: (_lang?: string) => [],
      getTopNavigation: (_lang?: string) => [],
      resolve: (_pathname: string) => ({ type: "not-found" as const }),
    } as unknown as DuneEngine["router"],
    themes: {} as unknown as DuneEngine["themes"],
    init: () => Promise.resolve(),
    resolve: resolveOverride ?? ((_route: string) => Promise.resolve({ type: "not-found" as const })),
    loadPage: (_sourcePath: string) => Promise.reject(new Error("not implemented")),
    serveMedia: (_mediaPath: string) => Promise.resolve(null),
    rebuild: () => Promise.resolve(),
    themeConfig: {},
    getAvailableThemes: () => Promise.resolve([]),
    switchTheme: (_name: string) => Promise.resolve(),
    createPreviewTheme: (_name: string) => Promise.reject(new Error("not implemented")),
    setPluginTemplateDirs: (_dirs: string[]) => {},
    storage: {} as unknown as DuneEngine["storage"],
  };
}

const stubSearch = {
  search: () => Promise.resolve([]),
  suggest: () => Promise.resolve([]),
  build: () => Promise.resolve(),
} as unknown as SearchEngine;

/** Assemble the production API handler around a stub engine. */
function makeHandler(
  pages: PageIndex[],
  taxonomyMap: TaxonomyMap = {},
  resolveOverride?: (route: string) => Promise<ResolveResult>,
): (req: Request) => Promise<Response | null> {
  const engine = makeEngine(pages, taxonomyMap, resolveOverride);
  const taxonomy = createTaxonomyEngine({ pages, taxonomyMap });
  const collections = createCollectionEngine({ pages, taxonomyMap, loadPage: engine.loadPage });
  return createApiHandler({ engine, collections, taxonomy, search: stubSearch });
}

// ── GET /api/pages ───────────────────────────────────────────────────────────

Deno.test("createApiHandler GET /api/pages: returns published+routable pages", async () => {
  const pages = [
    makePageIndex({ sourcePath: "01.home/default.md", route: "/", title: "Home" }),
    makePageIndex({ sourcePath: "02.blog/default.md", route: "/blog", title: "Blog" }),
    makePageIndex({ sourcePath: "03.draft/default.md", route: "/draft", published: false }),
    makePageIndex({ sourcePath: "04.hidden/default.md", route: "/hidden", routable: false }),
  ];
  const handler = makeHandler(pages);

  const res = await handler(new Request("http://localhost/api/pages"));
  assertEquals(res!.status, 200);
  const body = await res!.json();
  assertEquals(body.meta.total, 2);
  const routes = body.items.map((p: { route: string }) => p.route).sort();
  assertEquals(routes, ["/", "/blog"]);
});

Deno.test("createApiHandler GET /api/pages: pagination with limit and offset", async () => {
  const pages = Array.from({ length: 5 }, (_, i) =>
    makePageIndex({ sourcePath: `0${i + 1}.page/default.md`, route: `/page-${i + 1}`, order: i + 1 }));
  const handler = makeHandler(pages);

  const res = await handler(new Request("http://localhost/api/pages?limit=2&offset=2"));
  assertEquals(res!.status, 200);
  const body = await res!.json();
  assertEquals(body.meta.total, 5);
  assertEquals(body.meta.limit, 2);
  assertEquals(body.items.length, 2);
});

Deno.test("createApiHandler GET /api/pages: template filter returns only matching pages", async () => {
  const pages = [
    makePageIndex({ sourcePath: "01.home/default.md", route: "/", template: "default" }),
    makePageIndex({ sourcePath: "02.blog/01.post-a/default.md", route: "/blog/post-a", template: "post" }),
    makePageIndex({ sourcePath: "02.blog/02.post-b/default.md", route: "/blog/post-b", template: "post" }),
  ];
  const handler = makeHandler(pages);

  const res = await handler(new Request("http://localhost/api/pages?template=post"));
  assertEquals(res!.status, 200);
  const body = await res!.json();
  assertEquals(body.meta.total, 2);
  for (const item of body.items) assertEquals(item.template, "post");
});

// ── GET /api/pages/:route ──────────────────────────────────────────────────

Deno.test("createApiHandler GET /api/pages/*: returns page JSON with html for known route", async () => {
  const page = makeFullPage({
    route: "/blog/hello",
    frontmatter: { title: "Hello World", date: "2024-01-15" },
    html: () => Promise.resolve("<h1>Hello World</h1>"),
    media: [
      { name: "cover.jpg", path: "02.blog/01.hello/cover.jpg", type: "image/jpeg", size: 1024, meta: {}, url: "/content-media/02.blog/01.hello/cover.jpg" },
    ],
  });
  const handler = makeHandler([], {}, (route) =>
    Promise.resolve(route === "/blog/hello" ? { type: "page" as const, page } : { type: "not-found" as const }));

  const res = await handler(new Request("http://localhost/api/pages/blog/hello"));
  assertEquals(res!.status, 200);
  const body = await res!.json();
  assertEquals(body.route, "/blog/hello");
  assertEquals(body.title, "Hello World");
  assertEquals(body.html, "<h1>Hello World</h1>");
  assertEquals(body.template, "post");
  assertExists(body.frontmatter);
  assertEquals(body.media.length, 1);
  assertEquals(body.media[0].name, "cover.jpg");
});

Deno.test("createApiHandler GET /api/pages/*: returns 404 for unknown route", async () => {
  const handler = makeHandler([], {}, () => Promise.resolve({ type: "not-found" as const }));
  const res = await handler(new Request("http://localhost/api/pages/does-not-exist"));
  assertEquals(res!.status, 404);
  assertExists((await res!.json()).error);
});

// ── GET /api/taxonomy/:name ────────────────────────────────────────────────

Deno.test("createApiHandler GET /api/taxonomy/:name: returns value counts for known taxonomy", async () => {
  const taxonomyMap: TaxonomyMap = {
    tag: {
      deno: ["02.blog/01.post-a/default.md", "02.blog/02.post-b/default.md"],
      typescript: ["02.blog/01.post-a/default.md"],
    },
  };
  // The taxonomy engine counts published pages present in the index, so the
  // referenced source paths must exist as pages.
  const pages = [
    makePageIndex({ sourcePath: "02.blog/01.post-a/default.md", route: "/blog/post-a", taxonomy: { tag: ["deno", "typescript"] } }),
    makePageIndex({ sourcePath: "02.blog/02.post-b/default.md", route: "/blog/post-b", taxonomy: { tag: ["deno"] } }),
  ];
  const handler = makeHandler(pages, taxonomyMap);

  const res = await handler(new Request("http://localhost/api/taxonomy/tag"));
  assertEquals(res!.status, 200);
  const body = await res!.json();
  assertEquals(body.name, "tag");
  assertEquals(body.values.deno, 2);
  assertEquals(body.values.typescript, 1);
});

Deno.test("createApiHandler GET /api/taxonomy/:name: returns 404 for nonexistent taxonomy", async () => {
  const handler = makeHandler([], { tag: { deno: ["01.home/default.md"] } });
  const res = await handler(new Request("http://localhost/api/taxonomy/nonexistent"));
  assertEquals(res!.status, 404);
  assertExists((await res!.json()).error);
});

// ── Unknown route ──────────────────────────────────────────────────────────

Deno.test("createApiHandler: unknown /api/* path returns 404", async () => {
  const handler = makeHandler([]);
  const res = await handler(new Request("http://localhost/api/unknown-endpoint"));
  assertEquals(res!.status, 404);
});

Deno.test("createApiHandler: non-/api/ path returns null (not handled)", async () => {
  const handler = makeHandler([]);
  const res = await handler(new Request("http://localhost/not-api"));
  assertEquals(res, null);
});
