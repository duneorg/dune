/**
 * Tests for src/mcp/tools.ts — MCP tool handler logic.
 *
 * Tests the tool handlers directly without going through the server,
 * using stub DuneEngine and SearchEngine objects.
 */

import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { buildTools } from "../../src/mcp/tools.ts";
import type { DuneEngine } from "../../src/core/engine.ts";
import type { PageIndex, Page } from "../../src/content/types.ts";

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

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
    sourcePath: "01.home/default.md",
    route: "/",
    language: "en",
    format: "md",
    template: "default",
    navTitle: "Home",
    frontmatter: { title: "Home", published: true },
    rawContent: null,
    html: () => Promise.resolve("<p>Hello</p>"),
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
    ...overrides,
  };
}

function makeEngine(pages: PageIndex[], resolveMap?: Map<string, Page>): DuneEngine {
  return {
    pages,
    taxonomyMap: {},
    config: {
      site: { title: "Test Site", url: "http://localhost", author: { name: "" }, taxonomies: [], metadata: {}, routes: {}, redirects: {}, description: "" },
      theme: { name: "starter", custom: {} },
      system: { content: { dir: "content", markdown: { extra: false, auto_links: false, auto_url_links: false } }, debug: false },
      plugins: {},
      pluginList: [],
    },
    site: { title: "Test Site", url: "http://localhost", author: { name: "" }, taxonomies: [], metadata: {}, routes: {}, redirects: {}, description: "" },
    blueprints: {},
    storage: {
      async read(path: string): Promise<Uint8Array> {
        // Return minimal content for tests that call get_page_source
        const content = `---\ntitle: Test\npublished: true\n---\n\n# Test\n`;
        return new TextEncoder().encode(content);
      },
    } as unknown as DuneEngine["storage"],
    themes: {
      theme: {
        manifest: { name: "starter", version: "0.1", description: "Starter" },
        templateNames: ["default", "blog"],
        layoutNames: ["layout"],
      },
    } as unknown as DuneEngine["themes"],
    themeConfig: {},
    router: {} as DuneEngine["router"],
    resolve: async (route: string) => {
      if (resolveMap) {
        const page = resolveMap.get(route);
        if (page) return { type: "page", page };
      }
      return { type: "not-found" };
    },
    loadPage: async () => { throw new Error("not implemented"); },
    serveMedia: async () => null,
    rebuild: async () => {},
    getAvailableThemes: async () => [],
    switchTheme: async () => {},
    createPreviewTheme: async () => ({ theme: { manifest: { name: "starter" }, templateNames: [], layoutNames: [] } }) as unknown as DuneEngine["themes"],
    setPluginTemplateDirs: () => {},
    init: async () => {},
  } as unknown as DuneEngine;
}

// ---------------------------------------------------------------------------
// list_pages tool
// ---------------------------------------------------------------------------

Deno.test("list_pages: returns all pages when no filter", async () => {
  const pages = [
    makePageIndex({ route: "/", title: "Home" }),
    makePageIndex({ route: "/about", title: "About", sourcePath: "02.about/default.md" }),
  ];
  const engine = makeEngine(pages);
  const tools = buildTools({ engine, search: null });
  const listPages = tools.find((t) => t.meta.name === "list_pages")!;

  const result = await listPages.handler({});
  const data = JSON.parse(result.content[0].text);

  assertEquals(data.total, 2);
  assertEquals(data.pages.length, 2);
});

Deno.test("list_pages: filters by template", async () => {
  const pages = [
    makePageIndex({ route: "/", template: "default" }),
    makePageIndex({ route: "/blog", template: "blog", sourcePath: "02.blog/default.md" }),
  ];
  const engine = makeEngine(pages);
  const tools = buildTools({ engine, search: null });
  const listPages = tools.find((t) => t.meta.name === "list_pages")!;

  const result = await listPages.handler({ template: "blog" });
  const data = JSON.parse(result.content[0].text);

  assertEquals(data.total, 1);
  assertEquals(data.pages[0].route, "/blog");
});

Deno.test("list_pages: filters by published status", async () => {
  const pages = [
    makePageIndex({ route: "/pub", published: true }),
    makePageIndex({ route: "/draft", published: false, sourcePath: "02.draft/default.md" }),
  ];
  const engine = makeEngine(pages);
  const tools = buildTools({ engine, search: null });
  const listPages = tools.find((t) => t.meta.name === "list_pages")!;

  const result = await listPages.handler({ published: false });
  const data = JSON.parse(result.content[0].text);

  assertEquals(data.total, 1);
  assertEquals(data.pages[0].route, "/draft");
});

Deno.test("list_pages: respects limit and offset", async () => {
  const pages = Array.from({ length: 10 }, (_, i) =>
    makePageIndex({ route: `/${i}`, sourcePath: `${i}/default.md` })
  );
  const engine = makeEngine(pages);
  const tools = buildTools({ engine, search: null });
  const listPages = tools.find((t) => t.meta.name === "list_pages")!;

  const result = await listPages.handler({ limit: 3, offset: 2 });
  const data = JSON.parse(result.content[0].text);

  assertEquals(data.total, 10);
  assertEquals(data.pages.length, 3);
  assertEquals(data.offset, 2);
});

// ---------------------------------------------------------------------------
// get_page tool
// ---------------------------------------------------------------------------

Deno.test("get_page: returns page data for known route", async () => {
  const page = makeFullPage({ route: "/", frontmatter: { title: "Home", published: true } });
  const engine = makeEngine([], new Map([["/"  , page]]));
  const tools = buildTools({ engine, search: null });
  const getPage = tools.find((t) => t.meta.name === "get_page")!;

  const result = await getPage.handler({ route: "/" });
  assertExists(result.content[0].text);
  const data = JSON.parse(result.content[0].text);
  assertEquals(data.route, "/");
  assertEquals(data.frontmatter.title, "Home");
  assertEquals(data.html, "<p>Hello</p>");
});

Deno.test("get_page: returns isError for unknown route", async () => {
  const engine = makeEngine([]);
  const tools = buildTools({ engine, search: null });
  const getPage = tools.find((t) => t.meta.name === "get_page")!;

  const result = await getPage.handler({ route: "/nonexistent" });
  assertEquals(result.isError, true);
  assertEquals(result.content[0].text.includes("not found"), true);
});

Deno.test("get_page: skips html when include_html=false", async () => {
  const page = makeFullPage();
  const engine = makeEngine([], new Map([["/"  , page]]));
  const tools = buildTools({ engine, search: null });
  const getPage = tools.find((t) => t.meta.name === "get_page")!;

  const result = await getPage.handler({ route: "/", include_html: false });
  const data = JSON.parse(result.content[0].text);
  assertEquals(data.html, undefined);
});

// ---------------------------------------------------------------------------
// get_taxonomy tool
// ---------------------------------------------------------------------------

Deno.test("get_taxonomy: lists all taxonomies when name omitted", async () => {
  const engine = makeEngine([]);
  // deno-lint-ignore no-explicit-any
  (engine as any).taxonomyMap = {
    category: { news: ["p1", "p2"], tutorial: ["p3"] },
    tag: { deno: ["p1"] },
  };
  const tools = buildTools({ engine, search: null });
  const getTax = tools.find((t) => t.meta.name === "get_taxonomy")!;

  const result = await getTax.handler({});
  const data = JSON.parse(result.content[0].text);

  assertEquals(typeof data.taxonomies, "object");
  assertExists(data.taxonomies.category);
  assertExists(data.taxonomies.tag);
});

Deno.test("get_taxonomy: returns value counts for named taxonomy", async () => {
  const engine = makeEngine([]);
  // deno-lint-ignore no-explicit-any
  (engine as any).taxonomyMap = {
    category: { news: ["p1", "p2"], tutorial: ["p3"] },
  };
  const tools = buildTools({ engine, search: null });
  const getTax = tools.find((t) => t.meta.name === "get_taxonomy")!;

  const result = await getTax.handler({ name: "category" });
  const data = JSON.parse(result.content[0].text);

  assertEquals(data.name, "category");
  assertEquals(data.values.news, 2);
  assertEquals(data.values.tutorial, 1);
});

Deno.test("get_taxonomy: returns isError for unknown taxonomy", async () => {
  const engine = makeEngine([]);
  // deno-lint-ignore no-explicit-any
  (engine as any).taxonomyMap = {};
  const tools = buildTools({ engine, search: null });
  const getTax = tools.find((t) => t.meta.name === "get_taxonomy")!;

  const result = await getTax.handler({ name: "nonexistent" });
  assertEquals(result.isError, true);
});

// ---------------------------------------------------------------------------
// get_runtime_info tool
// ---------------------------------------------------------------------------

Deno.test("get_runtime_info: returns page counts and theme info", async () => {
  const pages = [
    makePageIndex({ route: "/", published: true }),
    makePageIndex({ route: "/draft", published: false, sourcePath: "02.draft/default.md" }),
  ];
  const engine = makeEngine(pages);
  const tools = buildTools({ engine, search: null });
  const getRuntimeInfo = tools.find((t) => t.meta.name === "get_runtime_info")!;

  const result = await getRuntimeInfo.handler({});
  const data = JSON.parse(result.content[0].text);

  assertEquals(data.engine.pagesTotal, 2);
  assertEquals(data.engine.pagesPublished, 1);
  assertEquals(data.engine.pagesDraft, 1);
  assertExists(data.theme.name);
  assertExists(data.generatedAt);
});

// ---------------------------------------------------------------------------
// list_templates tool
// ---------------------------------------------------------------------------

Deno.test("list_templates: returns theme templates and layouts", async () => {
  const engine = makeEngine([]);
  const tools = buildTools({ engine, search: null });
  const listTemplates = tools.find((t) => t.meta.name === "list_templates")!;

  const result = await listTemplates.handler({});
  const data = JSON.parse(result.content[0].text);

  assertEquals(data.theme, "starter");
  assertEquals(Array.isArray(data.templates), true);
  assertEquals(Array.isArray(data.layouts), true);
});

// ---------------------------------------------------------------------------
// search_content tool — null search
// ---------------------------------------------------------------------------

Deno.test("search_content: returns isError when search not available", async () => {
  const engine = makeEngine([]);
  const tools = buildTools({ engine, search: null });
  const search = tools.find((t) => t.meta.name === "search_content")!;

  const result = await search.handler({ query: "test" });
  assertEquals(result.isError, true);
});

// ---------------------------------------------------------------------------
// list_blueprints tool
// ---------------------------------------------------------------------------

Deno.test("list_blueprints: returns empty list when no blueprints", async () => {
  const engine = makeEngine([]);
  const tools = buildTools({ engine, search: null });
  const listBlueprints = tools.find((t) => t.meta.name === "list_blueprints")!;

  const result = await listBlueprints.handler({});
  const data = JSON.parse(result.content[0].text);

  assertEquals(data.total, 0);
  assertEquals(data.blueprints.length, 0);
});

Deno.test("list_blueprints: returns blueprint list when blueprints exist", async () => {
  const engine = makeEngine([]);
  // deno-lint-ignore no-explicit-any
  (engine as any).blueprints = {
    post: {
      title: "Blog Post",
      fields: {
        title: { type: "text", label: "Title", required: true },
        date: { type: "date", label: "Date", required: true },
        tags: { type: "list", label: "Tags" },
      },
    },
  };

  const tools = buildTools({ engine, search: null });
  const listBlueprints = tools.find((t) => t.meta.name === "list_blueprints")!;

  const result = await listBlueprints.handler({});
  const data = JSON.parse(result.content[0].text);

  assertEquals(data.total, 1);
  assertEquals(data.blueprints[0].template, "post");
  assertEquals(data.blueprints[0].requiredFields, ["title", "date"]);
  assertEquals(data.blueprints[0].fieldCount, 3);
});

Deno.test("list_blueprints: returns full schema when template specified", async () => {
  const engine = makeEngine([]);
  // deno-lint-ignore no-explicit-any
  (engine as any).blueprints = {
    post: {
      title: "Blog Post",
      fields: {
        title: { type: "text", label: "Title", required: true },
      },
    },
  };

  const tools = buildTools({ engine, search: null });
  const listBlueprints = tools.find((t) => t.meta.name === "list_blueprints")!;

  const result = await listBlueprints.handler({ template: "post" });
  const data = JSON.parse(result.content[0].text);

  assertEquals(data.template, "post");
  assertEquals(data.title, "Blog Post");
  assertExists(data.fields.title);
  assertEquals(data.fields.title.type, "text");
});

Deno.test("list_blueprints: returns isError for unknown template", async () => {
  const engine = makeEngine([]);
  const tools = buildTools({ engine, search: null });
  const listBlueprints = tools.find((t) => t.meta.name === "list_blueprints")!;

  const result = await listBlueprints.handler({ template: "nonexistent" });
  assertEquals(result.isError, true);
});

// ---------------------------------------------------------------------------
// get_page_source tool
// ---------------------------------------------------------------------------

Deno.test("get_page_source: returns source content for known route", async () => {
  const pages = [makePageIndex({ route: "/", sourcePath: "01.home/default.md" })];
  const engine = makeEngine(pages);
  const tools = buildTools({ engine, search: null });
  const getSource = tools.find((t) => t.meta.name === "get_page_source")!;

  const result = await getSource.handler({ route: "/" });
  assertExists(result.content[0].text);
  const data = JSON.parse(result.content[0].text);

  assertEquals(data.route, "/");
  assertEquals(data.sourcePath, "01.home/default.md");
  assertEquals(data.format, "md");
  assertExists(data.content);
  assertExists(data.frontmatter);
});

Deno.test("get_page_source: returns isError for unknown route", async () => {
  const engine = makeEngine([]);
  const tools = buildTools({ engine, search: null });
  const getSource = tools.find((t) => t.meta.name === "get_page_source")!;

  const result = await getSource.handler({ route: "/nonexistent" });
  assertEquals(result.isError, true);
});

Deno.test("get_page_source: normalizes route without leading slash", async () => {
  const pages = [makePageIndex({ route: "/blog/hello" })];
  const engine = makeEngine(pages);
  const tools = buildTools({ engine, search: null });
  const getSource = tools.find((t) => t.meta.name === "get_page_source")!;

  const result = await getSource.handler({ route: "blog/hello" });
  const data = JSON.parse(result.content[0].text);
  assertEquals(data.route, "/blog/hello");
});
