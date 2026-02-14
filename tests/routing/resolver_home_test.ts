/**
 * Tests for configurable home page resolution.
 *
 * Verifies that the route resolver correctly maps "/" to the
 * configured or autodetected home page slug.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createRouteResolver } from "../../src/routing/resolver.ts";
import type { PageIndex } from "../../src/content/types.ts";
import type { SiteConfig } from "../../src/config/types.ts";

/** Minimal SiteConfig for testing */
function mockSiteConfig(overrides?: Partial<SiteConfig>): SiteConfig {
  return {
    title: "Test Site",
    description: "",
    url: "http://localhost:3000",
    author: { name: "test" },
    metadata: {},
    taxonomies: [],
    routes: {},
    redirects: {},
    ...overrides,
  };
}

/** Create a minimal PageIndex for testing */
function mockPage(overrides: Partial<PageIndex> & { sourcePath: string; route: string }): PageIndex {
  return {
    language: "en",
    format: "md",
    template: "default",
    title: "Test",
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

// --- Home page resolution ---

Deno.test("resolver: maps / to configured homeSlug", () => {
  const pages = [
    mockPage({ sourcePath: "01.efficiency/default.md", route: "/efficiency" }),
    mockPage({ sourcePath: "02.blog/blog.md", route: "/blog", order: 2 }),
  ];

  const resolver = createRouteResolver({
    pages,
    site: mockSiteConfig(),
    homeSlug: "efficiency",
  });

  const match = resolver.resolve("/");
  assertEquals(match?.type, "page");
  assertEquals(match?.page?.route, "/efficiency");
});

Deno.test("resolver: home page accessible via natural route too", () => {
  const pages = [
    mockPage({ sourcePath: "01.efficiency/default.md", route: "/efficiency" }),
  ];

  const resolver = createRouteResolver({
    pages,
    site: mockSiteConfig(),
    homeSlug: "efficiency",
  });

  // "/" resolves to efficiency page
  const homeMatch = resolver.resolve("/");
  assertEquals(homeMatch?.page?.route, "/efficiency");

  // "/efficiency" also resolves
  const naturalMatch = resolver.resolve("/efficiency");
  assertEquals(naturalMatch?.page?.route, "/efficiency");
});

Deno.test("resolver: backward compat with home slug", () => {
  const pages = [
    mockPage({ sourcePath: "01.home/default.md", route: "/home" }),
  ];

  const resolver = createRouteResolver({
    pages,
    site: mockSiteConfig(),
    homeSlug: "home",
  });

  const match = resolver.resolve("/");
  assertEquals(match?.type, "page");
  assertEquals(match?.page?.route, "/home");
});

Deno.test("resolver: returns null when home page missing", () => {
  const pages = [
    mockPage({ sourcePath: "02.about/default.md", route: "/about", order: 2 }),
  ];

  const resolver = createRouteResolver({
    pages,
    site: mockSiteConfig(),
    homeSlug: "nonexistent",
  });

  const match = resolver.resolve("/");
  assertEquals(match, null);
});

Deno.test("resolver: unpublished home page returns null for /", () => {
  const pages = [
    mockPage({
      sourcePath: "01.efficiency/default.md",
      route: "/efficiency",
      published: false,
    }),
  ];

  const resolver = createRouteResolver({
    pages,
    site: mockSiteConfig(),
    homeSlug: "efficiency",
  });

  const match = resolver.resolve("/");
  assertEquals(match, null);
});

Deno.test("resolver: draft status home page returns null for /", () => {
  const pages = [
    mockPage({
      sourcePath: "01.efficiency/default.md",
      route: "/efficiency",
      status: "draft",
    }),
  ];

  const resolver = createRouteResolver({
    pages,
    site: mockSiteConfig(),
    homeSlug: "efficiency",
  });

  const match = resolver.resolve("/");
  assertEquals(match, null);
});

Deno.test("resolver: redirects take priority over home page", () => {
  const pages = [
    mockPage({ sourcePath: "01.efficiency/default.md", route: "/efficiency" }),
  ];

  const resolver = createRouteResolver({
    pages,
    site: mockSiteConfig({
      redirects: { "/": "/about" },
    }),
    homeSlug: "efficiency",
  });

  const match = resolver.resolve("/");
  assertEquals(match?.type, "redirect");
  assertEquals(match?.redirectTo, "/about");
});

Deno.test("resolver: rebuild updates home page", () => {
  const pages = [
    mockPage({ sourcePath: "01.home/default.md", route: "/home" }),
  ];

  const resolver = createRouteResolver({
    pages,
    site: mockSiteConfig(),
    homeSlug: "home",
  });

  // Initially resolves to /home
  assertEquals(resolver.resolve("/")?.page?.route, "/home");

  // Rebuild with new pages and new homeSlug
  const newPages = [
    mockPage({ sourcePath: "01.landing/default.md", route: "/landing" }),
  ];
  resolver.rebuild(newPages, "landing");

  assertEquals(resolver.resolve("/")?.page?.route, "/landing");
});

Deno.test("resolver: non-home routes unaffected", () => {
  const pages = [
    mockPage({ sourcePath: "01.home/default.md", route: "/home" }),
    mockPage({ sourcePath: "02.blog/blog.md", route: "/blog", order: 2, depth: 0 }),
    mockPage({ sourcePath: "02.blog/01.post/post.md", route: "/blog/post", order: 1, depth: 1 }),
  ];

  const resolver = createRouteResolver({
    pages,
    site: mockSiteConfig(),
    homeSlug: "home",
  });

  assertEquals(resolver.resolve("/blog")?.page?.route, "/blog");
  assertEquals(resolver.resolve("/blog/post")?.page?.route, "/blog/post");
  assertEquals(resolver.resolve("/nonexistent"), null);
});
