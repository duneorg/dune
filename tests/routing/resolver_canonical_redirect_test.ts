/**
 * Tests for canonical redirect behaviour (v0.20 trailing-slash URL correctness).
 *
 * Page-folder pages serve at trailing-slash routes ("/blog/my-post/").
 * Flat content files serve at no-slash routes ("/articles/my-article").
 *
 * When a request arrives at the wrong slash form and the correct form exists,
 * the resolver issues a 301 redirect. If neither form exists, it returns null
 * (404). If both forms exist as independent resources, each serves its own page.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createRouteResolver } from "../../src/routing/resolver.ts";
import type { PageIndex } from "../../src/content/types.ts";
import type { SiteConfig } from "../../src/config/types.ts";

function mockSiteConfig(): SiteConfig {
  return {
    title: "Test Site",
    description: "",
    url: "http://localhost:3000",
    author: { name: "test" },
    metadata: {},
    taxonomies: [],
    routes: {},
    redirects: {},
  };
}

function mockPage(
  overrides: Partial<PageIndex> & { sourcePath: string; route: string },
): PageIndex {
  return {
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
    mtime: Date.now(),
    hash: "abc",
    ...overrides,
  };
}

// --- Trailing slash → no slash redirect (flat file) ---

Deno.test("resolver: trailing slash redirects to flat file at no-slash route", () => {
  const pages = [
    mockPage({
      sourcePath: "articles/my-article.md",
      route: "/articles/my-article",
    }),
  ];
  const resolver = createRouteResolver({ pages, site: mockSiteConfig(), homeSlug: "home" });

  const match = resolver.resolve("/articles/my-article/");
  assertEquals(match?.type, "redirect");
  assertEquals(match?.redirectTo, "/articles/my-article");
});

// --- No slash → trailing slash redirect (page-folder) ---

Deno.test("resolver: no-slash redirects to page-folder at trailing-slash route", () => {
  const pages = [
    mockPage({
      sourcePath: "02.blog/01.my-post/default.md",
      route: "/blog/my-post/",
    }),
  ];
  const resolver = createRouteResolver({ pages, site: mockSiteConfig(), homeSlug: "home" });

  const match = resolver.resolve("/blog/my-post");
  assertEquals(match?.type, "redirect");
  assertEquals(match?.redirectTo, "/blog/my-post/");
});

// --- Direct hit: no redirect when form is already canonical ---

Deno.test("resolver: flat file served at correct no-slash URL (no redirect)", () => {
  const pages = [
    mockPage({
      sourcePath: "articles/my-article.md",
      route: "/articles/my-article",
    }),
  ];
  const resolver = createRouteResolver({ pages, site: mockSiteConfig(), homeSlug: "home" });

  const match = resolver.resolve("/articles/my-article");
  assertEquals(match?.type, "page");
  assertEquals(match?.page?.route, "/articles/my-article");
});

Deno.test("resolver: page-folder served at correct trailing-slash URL (no redirect)", () => {
  const pages = [
    mockPage({
      sourcePath: "02.blog/01.my-post/default.md",
      route: "/blog/my-post/",
    }),
  ];
  const resolver = createRouteResolver({ pages, site: mockSiteConfig(), homeSlug: "home" });

  const match = resolver.resolve("/blog/my-post/");
  assertEquals(match?.type, "page");
  assertEquals(match?.page?.route, "/blog/my-post/");
});

// --- Neither form exists → 404 ---

Deno.test("resolver: neither form exists returns null (no speculation)", () => {
  const pages = [
    mockPage({
      sourcePath: "02.blog/01.other-post/default.md",
      route: "/blog/other-post/",
    }),
  ];
  const resolver = createRouteResolver({ pages, site: mockSiteConfig(), homeSlug: "home" });

  // A sub-page exists but neither /about nor /about/ do
  assertEquals(resolver.resolve("/about"), null);
  assertEquals(resolver.resolve("/about/"), null);
});

// --- Both forms exist as distinct resources ---

Deno.test("resolver: about.md and about/default.md coexist as distinct pages", () => {
  const pages = [
    mockPage({ sourcePath: "about.md", route: "/about" }),
    mockPage({ sourcePath: "about/default.md", route: "/about/", title: "About Folder" }),
  ];
  const resolver = createRouteResolver({ pages, site: mockSiteConfig(), homeSlug: "home" });

  const noSlash = resolver.resolve("/about");
  assertEquals(noSlash?.type, "page");
  assertEquals(noSlash?.page?.sourcePath, "about.md");

  const withSlash = resolver.resolve("/about/");
  assertEquals(withSlash?.type, "page");
  assertEquals(withSlash?.page?.sourcePath, "about/default.md");
});

// --- Home page: trailing-slash page-folder resolved from homeSlug ---

Deno.test("resolver: home page-folder with trailing slash resolves from /", () => {
  const pages = [
    mockPage({ sourcePath: "01.home/default.md", route: "/home/" }),
  ];
  const resolver = createRouteResolver({ pages, site: mockSiteConfig(), homeSlug: "home" });

  const match = resolver.resolve("/");
  assertEquals(match?.type, "page");
  assertEquals(match?.page?.route, "/home/");
});

// --- Multilingual: trailing-slash page-folder routes must not loop ---

Deno.test("resolver: multilingual page-folder trailing-slash URL returns page, not redirect loop", () => {
  // Regression: "/fr/ecosystem/" was stripping the lang prefix via split/filter(Boolean)
  // which dropped the trailing slash, producing route "/ecosystem" instead of "/ecosystem/".
  // Step 5 (canonical redirect) then found "/ecosystem/" at the "other form" and issued
  // a 301 to "/fr/ecosystem/" — the same URL — causing an infinite redirect loop.
  const pages = [
    mockPage({ sourcePath: "01.ecosystem/default.md", route: "/ecosystem/", language: "en" }),
    mockPage({ sourcePath: "01.ecosystem/default.fr.md", route: "/ecosystem/", language: "fr" }),
  ];
  const resolver = createRouteResolver({
    pages,
    site: mockSiteConfig(),
    homeSlug: "ecosystem",
    supportedLanguages: ["en", "fr"],
    defaultLanguage: "en",
  });

  // French trailing-slash URL must resolve to a page, never redirect to itself
  const fr = resolver.resolve("/fr/ecosystem/");
  assertEquals(fr?.type, "page");
  assertEquals(fr?.page?.language, "fr");

  // English (default lang, no prefix) also works
  const en = resolver.resolve("/ecosystem/");
  assertEquals(en?.type, "page");
  assertEquals(en?.page?.language, "en");

  // Missing trailing slash redirects to canonical form (not a loop)
  const noSlash = resolver.resolve("/fr/ecosystem");
  assertEquals(noSlash?.type, "redirect");
  assertEquals(noSlash?.redirectTo, "/fr/ecosystem/");
});
