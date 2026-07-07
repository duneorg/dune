import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveThemeConfig } from "../../src/routing/theme-config-resolver.ts";
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

/**
 * Builds a fixture with a three-level tree:
 *   getting-started (section, theme_config: {color_scheme: green})
 *     └── intro (leaf page, no override)
 *     └── details (leaf page, theme_config: {color_scheme: purple})
 *   other (section, no override)
 *     └── page (leaf page, no override)
 */
function makeFixture(siteThemeConfig: Record<string, unknown> = { color_scheme: "blue", show_search: true }) {
  const sectionFrontmatter = new Map<string, Record<string, unknown>>([
    ["01.getting-started/default.md", { title: "Getting Started", theme_config: { color_scheme: "green" } }],
    ["02.other/default.md", { title: "Other" }],
  ]);

  const section = makePage({
    sourcePath: "01.getting-started/default.md",
    route: "/getting-started",
    title: "Getting Started",
  });
  const intro = makePage({
    sourcePath: "01.getting-started/01.intro/page.md",
    route: "/getting-started/intro",
    title: "Intro",
    parentPath: "01.getting-started",
    depth: 1,
  });
  const details = makePage({
    sourcePath: "01.getting-started/02.details/page.md",
    route: "/getting-started/details",
    title: "Details",
    parentPath: "01.getting-started",
    depth: 1,
  });
  const other = makePage({
    sourcePath: "02.other/default.md",
    route: "/other",
    title: "Other",
  });
  const otherLeaf = makePage({
    sourcePath: "02.other/01.page/page.md",
    route: "/other/page",
    title: "Page",
    parentPath: "02.other",
    depth: 1,
  });

  const pages = [section, intro, details, other, otherLeaf];

  const fullPageFrontmatter = new Map<string, Record<string, unknown>>([
    [intro.sourcePath, {}],
    [details.sourcePath, { theme_config: { color_scheme: "purple" } }],
    [otherLeaf.sourcePath, {}],
    ...sectionFrontmatter,
  ]);

  const engine = {
    pages,
    themeConfig: siteThemeConfig,
    loadPage: (sourcePath: string) => {
      const index = pages.find((p) => p.sourcePath === sourcePath);
      if (!index) return Promise.reject(new Error(`not found: ${sourcePath}`));
      return Promise.resolve(makeFullPage(index, fullPageFrontmatter.get(sourcePath) ?? {}));
    },
  } as unknown as DuneEngine;

  return { engine, pages, intro, details, otherLeaf, fullPageFrontmatter };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test("resolveThemeConfig: leaf page inherits its section's theme_config override", async () => {
  const { engine, intro, fullPageFrontmatter } = makeFixture();
  const page = makeFullPage(intro, fullPageFrontmatter.get(intro.sourcePath));

  const result = await resolveThemeConfig(page, engine);
  assertEquals(result, { color_scheme: "green", show_search: true });
});

Deno.test("resolveThemeConfig: page's own theme_config overrides its section's", async () => {
  const { engine, details, fullPageFrontmatter } = makeFixture();
  const page = makeFullPage(details, fullPageFrontmatter.get(details.sourcePath));

  const result = await resolveThemeConfig(page, engine);
  assertEquals(result, { color_scheme: "purple", show_search: true });
});

Deno.test("resolveThemeConfig: page under a section with no override falls back to site-level config", async () => {
  const { engine, otherLeaf, fullPageFrontmatter } = makeFixture();
  const page = makeFullPage(otherLeaf, fullPageFrontmatter.get(otherLeaf.sourcePath));

  const result = await resolveThemeConfig(page, engine);
  assertEquals(result, { color_scheme: "blue", show_search: true });
});

Deno.test("resolveThemeConfig: shallow-merges — only matching keys are overridden", async () => {
  const { engine, intro, fullPageFrontmatter } = makeFixture({ color_scheme: "blue", show_search: true, scheme_switcher: false });
  const page = makeFullPage(intro, fullPageFrontmatter.get(intro.sourcePath));

  const result = await resolveThemeConfig(page, engine);
  assertEquals(result, { color_scheme: "green", show_search: true, scheme_switcher: false });
});
