import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { generateSitemap } from "../../src/sitemap/generator.ts";
import type { PageIndex } from "../../src/content/types.ts";

function makePage(overrides: Partial<PageIndex> = {}): PageIndex {
  return {
    sourcePath: "01.home/default.md",
    route: "/home",
    language: "en",
    format: "md",
    template: "default",
    title: "Home",
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
    mtime: new Date("2025-06-15").getTime(),
    hash: "abc123",
    ...overrides,
  };
}

Deno.test("generateSitemap: includes published routable pages", () => {
  const pages = [
    makePage({ route: "/home", depth: 0 }),
    makePage({ route: "/about", depth: 0, sourcePath: "02.about/default.md" }),
  ];
  const xml = generateSitemap(pages, "https://example.com");

  assertEquals(xml.includes("<loc>https://example.com/home</loc>"), true);
  assertEquals(xml.includes("<loc>https://example.com/about</loc>"), true);
  assertEquals(xml.includes('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"'), true);
});

Deno.test("generateSitemap: excludes unpublished pages", () => {
  const pages = [
    makePage({ route: "/home" }),
    makePage({ route: "/draft", published: false }),
  ];
  const xml = generateSitemap(pages, "https://example.com");

  assertEquals(xml.includes("/home</loc>"), true);
  assertEquals(xml.includes("/draft</loc>"), false);
});

Deno.test("generateSitemap: excludes non-routable pages", () => {
  const pages = [
    makePage({ route: "/home" }),
    makePage({ route: "/module", routable: false }),
  ];
  const xml = generateSitemap(pages, "https://example.com");

  assertEquals(xml.includes("/module</loc>"), false);
});

Deno.test("generateSitemap: excludes module pages", () => {
  const pages = [
    makePage({ route: "/home" }),
    makePage({ route: "/mod", isModule: true }),
  ];
  const xml = generateSitemap(pages, "https://example.com");

  assertEquals(xml.includes("/mod</loc>"), false);
});

Deno.test("generateSitemap: includes lastmod from mtime", () => {
  const pages = [
    makePage({ route: "/home", mtime: new Date("2025-06-15").getTime() }),
  ];
  const xml = generateSitemap(pages, "https://example.com");

  assertEquals(xml.includes("<lastmod>2025-06-15</lastmod>"), true);
});

Deno.test("generateSitemap: priority decreases with depth", () => {
  const pages = [
    makePage({ route: "/home", depth: 0 }),
    makePage({ route: "/blog", depth: 1 }),
    makePage({ route: "/blog/post", depth: 2 }),
  ];
  const xml = generateSitemap(pages, "https://example.com");

  assertEquals(xml.includes("<priority>1.0</priority>"), true);
  assertEquals(xml.includes("<priority>0.8</priority>"), true);
  assertEquals(xml.includes("<priority>0.6</priority>"), true);
});

Deno.test("generateSitemap: strips trailing slash from siteUrl", () => {
  const pages = [makePage({ route: "/home" })];
  const xml = generateSitemap(pages, "https://example.com/");

  assertEquals(xml.includes("https://example.com/home"), true);
  assertEquals(xml.includes("https://example.com//home"), false);
});

Deno.test("generateSitemap: escapes XML special characters in URLs", () => {
  const pages = [makePage({ route: "/search?q=a&b=c" })];
  const xml = generateSitemap(pages, "https://example.com");

  assertEquals(xml.includes("&amp;"), true);
  assertEquals(xml.includes("?q=a&b"), false);
});

Deno.test("generateSitemap: empty pages produces valid XML", () => {
  const xml = generateSitemap([], "https://example.com");

  assertEquals(xml.includes('<?xml version="1.0"'), true);
  assertEquals(xml.includes("<urlset"), true);
  assertEquals(xml.includes("</urlset>"), true);
  assertEquals(xml.includes("<url>"), false);
});

Deno.test("generateSitemap: adds hreflang alternates for multilingual pages", () => {
  const pages = [
    makePage({
      route: "/webapps",
      sourcePath: "01.webapps/default.md",
      language: "en",
    }),
    makePage({
      route: "/de/webapps",
      sourcePath: "01.webapps/default.de.md",
      language: "de",
    }),
    makePage({
      route: "/fr/webapps",
      sourcePath: "01.webapps/default.fr.md",
      language: "fr",
    }),
  ];
  const xml = generateSitemap(pages, {
    siteUrl: "https://example.com",
    supportedLanguages: ["en", "de", "fr"],
    defaultLanguage: "en",
  });

  assertEquals(xml.includes('xmlns:xhtml="http://www.w3.org/1999/xhtml"'), true);
  assertEquals(xml.includes('hreflang="en"'), true);
  assertEquals(xml.includes('hreflang="de"'), true);
  assertEquals(xml.includes('hreflang="fr"'), true);
  assertEquals(xml.includes('hreflang="x-default"'), true);
  assertEquals(xml.includes("https://example.com/webapps"), true);
  assertEquals(xml.includes("https://example.com/de/webapps"), true);
  assertEquals(xml.includes("https://example.com/fr/webapps"), true);
});
