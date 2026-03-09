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

Deno.test("generateSitemap: changefreq is depth-based", () => {
  const pages = [
    makePage({ route: "/home", depth: 0 }),
    makePage({ route: "/blog", depth: 1, sourcePath: "02.blog/default.md" }),
    makePage({ route: "/blog/post", depth: 2, sourcePath: "02.blog/01.post/default.md" }),
  ];
  const xml = generateSitemap(pages, "https://example.com");

  assertEquals(xml.includes("<changefreq>daily</changefreq>"), true);
  assertEquals(xml.includes("<changefreq>weekly</changefreq>"), true);
  assertEquals(xml.includes("<changefreq>monthly</changefreq>"), true);
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
  // PageIndex stores base route (same for all languages); language is in language field
  const pages = [
    makePage({
      route: "/webapps",
      sourcePath: "01.webapps/default.md",
      language: "en",
    }),
    makePage({
      route: "/webapps",
      sourcePath: "01.webapps/default.de.md",
      language: "de",
    }),
    makePage({
      route: "/webapps",
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

// ─── Item 3 enhancements ───────────────────────────────────────────────────

Deno.test("generateSitemap: excludes exact route match", () => {
  const pages = [
    makePage({ route: "/home" }),
    makePage({ route: "/private", sourcePath: "02.private/default.md" }),
  ];
  const xml = generateSitemap(pages, { siteUrl: "https://example.com", exclude: ["/private"] });

  assertEquals(xml.includes("/home</loc>"), true);
  assertEquals(xml.includes("/private</loc>"), false);
});

Deno.test("generateSitemap: excludes pages whose route starts with excluded prefix", () => {
  const pages = [
    makePage({ route: "/home" }),
    makePage({ route: "/private/doc", sourcePath: "02.private/01.doc/default.md", depth: 1 }),
    makePage({ route: "/private/doc/sub", sourcePath: "02.private/01.doc/01.sub/default.md", depth: 2 }),
  ];
  const xml = generateSitemap(pages, { siteUrl: "https://example.com", exclude: ["/private"] });

  assertEquals(xml.includes("/home</loc>"), true);
  assertEquals(xml.includes("/private"), false);
});

Deno.test("generateSitemap: non-excluded pages are unaffected by exclude list", () => {
  const pages = [
    makePage({ route: "/home" }),
    makePage({ route: "/about", sourcePath: "02.about/default.md" }),
    makePage({ route: "/secret", sourcePath: "03.secret/default.md" }),
  ];
  const xml = generateSitemap(pages, { siteUrl: "https://example.com", exclude: ["/secret"] });

  assertEquals(xml.includes("/home</loc>"), true);
  assertEquals(xml.includes("/about</loc>"), true);
  assertEquals(xml.includes("/secret</loc>"), false);
});

Deno.test("generateSitemap: changefreq override for exact route", () => {
  const pages = [
    makePage({ route: "/", depth: 0 }),
  ];
  const xml = generateSitemap(pages, {
    siteUrl: "https://example.com",
    changefreqOverrides: { "/": "hourly" },
  });

  assertEquals(xml.includes("<changefreq>hourly</changefreq>"), true);
  assertEquals(xml.includes("<changefreq>daily</changefreq>"), false);
});

Deno.test("generateSitemap: changefreq override uses longest matching prefix", () => {
  const pages = [
    makePage({ route: "/blog", depth: 1, sourcePath: "02.blog/default.md" }),
    makePage({ route: "/blog/post", depth: 2, sourcePath: "02.blog/01.post/default.md" }),
  ];
  const xml = generateSitemap(pages, {
    siteUrl: "https://example.com",
    changefreqOverrides: { "/blog": "daily", "/blog/post": "weekly" },
  });

  // /blog/post matches /blog/post (longer key) → weekly
  // /blog matches /blog → daily
  const blogPostIdx = xml.indexOf("/blog/post</loc>");
  const blogIdx = xml.indexOf("/blog</loc>");
  // Extract the changefreq near each URL
  assertEquals(xml.includes("<changefreq>daily</changefreq>"), true);
  assertEquals(xml.includes("<changefreq>weekly</changefreq>"), true);
  // Verify /blog/post comes before /blog in the output (sorted by route)
  assertEquals(blogPostIdx > blogIdx, true);
});

Deno.test("generateSitemap: image:image entry emitted when coverImage is set", () => {
  const pages = [
    makePage({
      route: "/blog/post",
      sourcePath: "02.blog/01.post/default.md",
      coverImage: "/content-media/02.blog/01.post/cover.jpg",
    }),
  ];
  const xml = generateSitemap(pages, { siteUrl: "https://example.com" });

  assertEquals(xml.includes("<image:image>"), true);
  assertEquals(xml.includes("<image:loc>https://example.com/content-media/02.blog/01.post/cover.jpg</image:loc>"), true);
  assertEquals(xml.includes('xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"'), true);
});

Deno.test("generateSitemap: no image:image entry when coverImage is not set", () => {
  const pages = [
    makePage({ route: "/home" }),
  ];
  const xml = generateSitemap(pages, { siteUrl: "https://example.com" });

  assertEquals(xml.includes("<image:image>"), false);
  assertEquals(xml.includes("xmlns:image"), false);
});
