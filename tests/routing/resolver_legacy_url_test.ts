/**
 * Tests for legacy URL normalization: + → dash redirects.
 *
 * Older CMS systems (e.g., Antville) used + as a word separator in URL path
 * segments. Google may have these indexed. The resolver detects + in the path,
 * converts to dashes, and issues a 301 redirect — but only if the dashed route
 * actually exists in the content index.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createRouteResolver } from "../../src/routing/resolver.ts";
import type { PageIndex } from "../../src/content/types.ts";
import type { SiteConfig } from "../../src/config/types.ts";

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
    depth: 1,
    parentPath: null,
    taxonomy: {},
    mtime: Date.now(),
    hash: "abc",
    ...overrides,
  };
}

// --- Basic + → dash redirect ---

Deno.test("resolver: + in path redirects to dashed equivalent when page exists", () => {
  const pages = [
    mockPage({
      sourcePath: "mochazone/antville-summer-of-code-2007/default.md",
      route: "/mochazone/antville-summer-of-code-2007",
    }),
  ];

  const resolver = createRouteResolver({
    pages,
    site: mockSiteConfig(),
    homeSlug: "home",
  });

  const match = resolver.resolve("/mochazone/Antville+Summer+Of+Code+2007/");
  assertEquals(match?.type, "redirect");
  assertEquals(match?.redirectTo, "/mochazone/antville-summer-of-code-2007");
});

Deno.test("resolver: already-lowercased + path also redirects", () => {
  const pages = [
    mockPage({
      sourcePath: "mochazone/antville-summer-of-code-2007/default.md",
      route: "/mochazone/antville-summer-of-code-2007",
    }),
  ];

  const resolver = createRouteResolver({
    pages,
    site: mockSiteConfig(),
    homeSlug: "home",
  });

  const match = resolver.resolve("/mochazone/antville+summer+of+code+2007");
  assertEquals(match?.type, "redirect");
  assertEquals(match?.redirectTo, "/mochazone/antville-summer-of-code-2007");
});

Deno.test("resolver: + path with no matching dashed page returns null (real 404)", () => {
  const pages = [
    mockPage({
      sourcePath: "mochazone/antville-summer-of-code-2007/default.md",
      route: "/mochazone/antville-summer-of-code-2007",
    }),
  ];

  const resolver = createRouteResolver({
    pages,
    site: mockSiteConfig(),
    homeSlug: "home",
  });

  // This + URL has no corresponding dashed page
  const match = resolver.resolve("/mochazone/unknown+page");
  assertEquals(match, null);
});

Deno.test("resolver: dashed URL resolves as a normal page (not a redirect)", () => {
  const pages = [
    mockPage({
      sourcePath: "mochazone/antville-summer-of-code-2007/default.md",
      route: "/mochazone/antville-summer-of-code-2007",
    }),
  ];

  const resolver = createRouteResolver({
    pages,
    site: mockSiteConfig(),
    homeSlug: "home",
  });

  const match = resolver.resolve("/mochazone/antville-summer-of-code-2007");
  assertEquals(match?.type, "page");
  assertEquals(match?.page?.route, "/mochazone/antville-summer-of-code-2007");
});

// --- Double-plus / edge cases ---

Deno.test("resolver: consecutive + signs collapse to a single dash", () => {
  const pages = [
    mockPage({
      sourcePath: "page-with-double-plus/default.md",
      route: "/page-with-double-plus",
    }),
  ];

  const resolver = createRouteResolver({
    pages,
    site: mockSiteConfig(),
    homeSlug: "home",
  });

  const match = resolver.resolve("/page+with++double+plus");
  assertEquals(match?.type, "redirect");
  assertEquals(match?.redirectTo, "/page-with-double-plus");
});

Deno.test("resolver: top-level + path redirects correctly", () => {
  const pages = [
    mockPage({
      sourcePath: "hello-world/default.md",
      route: "/hello-world",
      depth: 0,
    }),
  ];

  const resolver = createRouteResolver({
    pages,
    site: mockSiteConfig(),
    homeSlug: "home",
  });

  const match = resolver.resolve("/hello+world");
  assertEquals(match?.type, "redirect");
  assertEquals(match?.redirectTo, "/hello-world");
});

// --- Priority: static redirects still take precedence ---

Deno.test("resolver: explicit site.yaml redirect takes priority over + normalization", () => {
  const pages = [
    mockPage({
      sourcePath: "mochazone/antville-summer-of-code-2007/default.md",
      route: "/mochazone/antville-summer-of-code-2007",
    }),
  ];

  const resolver = createRouteResolver({
    pages,
    site: mockSiteConfig({
      redirects: {
        "/mochazone/antville+summer+of+code+2007": "/custom-target",
      },
    }),
    homeSlug: "home",
  });

  // Static redirect wins even though the + normalization would also work
  const match = resolver.resolve("/mochazone/antville+summer+of+code+2007");
  assertEquals(match?.type, "redirect");
  assertEquals(match?.redirectTo, "/custom-target");
});
