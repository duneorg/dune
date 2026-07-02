/**
 * Tests for RouteResolver.getTranslations() — the data behind the
 * TemplateProps `translations` field (language switchers, hreflang links).
 *
 * For a given route, returns every supported language the page actually
 * exists in, with the language-prefixed URL for each. Respects
 * `include_default_in_url`. Returns [] on single-language sites.
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

const trilingualPages = [
  mockPage({ sourcePath: "01.about/default.md", route: "/about/", language: "en" }),
  mockPage({ sourcePath: "01.about/default.de.md", route: "/about/", language: "de" }),
  mockPage({ sourcePath: "01.about/default.fr.md", route: "/about/", language: "fr" }),
  // Only exists in en + de — no French translation
  mockPage({ sourcePath: "02.blog/01.post/default.md", route: "/blog/post/", language: "en" }),
  mockPage({ sourcePath: "02.blog/01.post/default.de.md", route: "/blog/post/", language: "de" }),
];

Deno.test("getTranslations: lists all languages a page exists in, default lang unprefixed", () => {
  const resolver = createRouteResolver({
    pages: trilingualPages,
    site: mockSiteConfig(),
    homeSlug: "home",
    supportedLanguages: ["en", "de", "fr"],
    defaultLanguage: "en",
  });

  assertEquals(resolver.getTranslations("/about/"), [
    { lang: "en", route: "/about/", url: "/about/" },
    { lang: "de", route: "/about/", url: "/de/about/" },
    { lang: "fr", route: "/about/", url: "/fr/about/" },
  ]);
});

Deno.test("getTranslations: omits languages the page does not exist in", () => {
  const resolver = createRouteResolver({
    pages: trilingualPages,
    site: mockSiteConfig(),
    homeSlug: "home",
    supportedLanguages: ["en", "de", "fr"],
    defaultLanguage: "en",
  });

  assertEquals(resolver.getTranslations("/blog/post/"), [
    { lang: "en", route: "/blog/post/", url: "/blog/post/" },
    { lang: "de", route: "/blog/post/", url: "/de/blog/post/" },
  ]);
});

Deno.test("getTranslations: include_default_in_url prefixes the default language too", () => {
  const resolver = createRouteResolver({
    pages: trilingualPages,
    site: mockSiteConfig(),
    homeSlug: "home",
    supportedLanguages: ["en", "de", "fr"],
    defaultLanguage: "en",
    includeDefaultInUrl: true,
  });

  assertEquals(resolver.getTranslations("/about/"), [
    { lang: "en", route: "/about/", url: "/en/about/" },
    { lang: "de", route: "/about/", url: "/de/about/" },
    { lang: "fr", route: "/about/", url: "/fr/about/" },
  ]);
});

Deno.test("getTranslations: empty on single-language sites", () => {
  const resolver = createRouteResolver({
    pages: [mockPage({ sourcePath: "01.about/default.md", route: "/about/" })],
    site: mockSiteConfig(),
    homeSlug: "home",
    supportedLanguages: ["en"],
    defaultLanguage: "en",
  });

  assertEquals(resolver.getTranslations("/about/"), []);
});

Deno.test("getTranslations: empty for routes that do not exist", () => {
  const resolver = createRouteResolver({
    pages: trilingualPages,
    site: mockSiteConfig(),
    homeSlug: "home",
    supportedLanguages: ["en", "de", "fr"],
    defaultLanguage: "en",
  });

  assertEquals(resolver.getTranslations("/nope/"), []);
});

Deno.test("getTranslations: normalizes the requested route (case, double slashes)", () => {
  const resolver = createRouteResolver({
    pages: trilingualPages,
    site: mockSiteConfig(),
    homeSlug: "home",
    supportedLanguages: ["en", "de", "fr"],
    defaultLanguage: "en",
  });

  const viaMessy = resolver.getTranslations("//About/");
  assertEquals(viaMessy.map((t) => t.lang), ["en", "de", "fr"]);
});

Deno.test("getTranslations: survives rebuild()", () => {
  const resolver = createRouteResolver({
    pages: trilingualPages,
    site: mockSiteConfig(),
    homeSlug: "home",
    supportedLanguages: ["en", "de", "fr"],
    defaultLanguage: "en",
  });

  resolver.rebuild([
    mockPage({ sourcePath: "03.team/default.md", route: "/team/", language: "en" }),
    mockPage({ sourcePath: "03.team/default.fr.md", route: "/team/", language: "fr" }),
  ]);

  assertEquals(resolver.getTranslations("/about/"), []);
  assertEquals(resolver.getTranslations("/team/"), [
    { lang: "en", route: "/team/", url: "/team/" },
    { lang: "fr", route: "/team/", url: "/fr/team/" },
  ]);
});
