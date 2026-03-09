/**
 * Tests for src/theme-helpers/mod.ts
 */

import { assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildPageTitle,
  formatDate,
  getCanonicalUrl,
  getSearchUrl,
  groupByYear,
  paginate,
  sortPages,
  truncate,
} from "../../src/theme-helpers/mod.ts";
import type { PageIndex } from "../../src/theme-helpers/mod.ts";

// === buildPageTitle ===

Deno.test("buildPageTitle: returns site name when page is null", () => {
  assertEquals(buildPageTitle(null, "My Site"), "My Site");
});

Deno.test("buildPageTitle: title only", () => {
  const page = { frontmatter: { title: "About" } };
  assertEquals(buildPageTitle(page, "My Site"), "About | My Site");
});

Deno.test("buildPageTitle: title and descriptor", () => {
  const page = { frontmatter: { title: "Services", descriptor: "Custom Solutions" } };
  assertEquals(buildPageTitle(page, "My Site"), "Services - Custom Solutions | My Site");
});

// === formatDate ===

Deno.test("formatDate: returns a non-empty string", () => {
  const result = formatDate(Date.UTC(2026, 2, 8)); // 8 Mar 2026
  assertEquals(typeof result, "string");
  assertEquals(result.length > 0, true);
});

Deno.test("formatDate: includes year", () => {
  const result = formatDate(Date.UTC(2026, 2, 8), "en");
  assertMatch(result, /2026/);
});

Deno.test("formatDate: custom options", () => {
  const result = formatDate(Date.UTC(2026, 0, 1), "en", { year: "numeric" });
  assertEquals(result, "2026");
});

// === getCanonicalUrl ===

Deno.test("getCanonicalUrl: combines base and path", () => {
  assertEquals(
    getCanonicalUrl("https://example.com", "/blog/hello"),
    "https://example.com/blog/hello",
  );
});

Deno.test("getCanonicalUrl: strips trailing slash from path", () => {
  assertEquals(
    getCanonicalUrl("https://example.com", "/blog/hello/"),
    "https://example.com/blog/hello",
  );
});

Deno.test("getCanonicalUrl: strips trailing slash from base", () => {
  assertEquals(
    getCanonicalUrl("https://example.com/", "/blog"),
    "https://example.com/blog",
  );
});

Deno.test("getCanonicalUrl: root path preserved", () => {
  assertEquals(
    getCanonicalUrl("https://example.com", "/"),
    "https://example.com/",
  );
});

// === paginate ===

Deno.test("paginate: first page", () => {
  const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const result = paginate(items, 1, 3);
  assertEquals(result.items, [1, 2, 3]);
  assertEquals(result.page, 1);
  assertEquals(result.totalPages, 4);
  assertEquals(result.total, 10);
  assertEquals(result.hasNext, true);
  assertEquals(result.hasPrev, false);
});

Deno.test("paginate: last page (partial)", () => {
  const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const result = paginate(items, 4, 3);
  assertEquals(result.items, [10]);
  assertEquals(result.hasNext, false);
  assertEquals(result.hasPrev, true);
});

Deno.test("paginate: clamps page to valid range", () => {
  const items = [1, 2, 3];
  assertEquals(paginate(items, 0, 10).page, 1);  // page < 1 → 1
  assertEquals(paginate(items, 99, 10).page, 1); // page > totalPages → totalPages
});

Deno.test("paginate: empty array", () => {
  const result = paginate([], 1, 10);
  assertEquals(result.items, []);
  assertEquals(result.totalPages, 1);
  assertEquals(result.total, 0);
  assertEquals(result.hasNext, false);
  assertEquals(result.hasPrev, false);
});

Deno.test("paginate: perPage of 1 is enforced minimum", () => {
  const result = paginate([1, 2, 3], 1, 0);
  assertEquals(result.perPage, 1);
});

// === sortPages ===

function makePage(title: string, date?: string | null, order = 0): PageIndex {
  return {
    sourcePath: `path/${title}.md`,
    route: `/${title}`,
    title,
    navTitle: title,
    language: "en",
    format: "md",
    published: true,
    status: "published",
    visible: true,
    routable: true,
    isModule: false,
    date: date ?? null,
    order,
    template: "default",
    depth: 0,
    parentPath: null,
    taxonomy: {},
    mtime: 0,
    hash: "",
  };
}

Deno.test("sortPages: by title asc", () => {
  const pages = [makePage("Zebra"), makePage("Apple"), makePage("Mango")];
  const sorted = sortPages(pages, "title", "asc");
  assertEquals(sorted.map((p) => p.title), ["Apple", "Mango", "Zebra"]);
});

Deno.test("sortPages: by title desc", () => {
  const pages = [makePage("Zebra"), makePage("Apple"), makePage("Mango")];
  const sorted = sortPages(pages, "title", "desc");
  assertEquals(sorted.map((p) => p.title), ["Zebra", "Mango", "Apple"]);
});

Deno.test("sortPages: by order asc", () => {
  const pages = [makePage("C", undefined, 3), makePage("A", undefined, 1), makePage("B", undefined, 2)];
  const sorted = sortPages(pages, "order", "asc");
  assertEquals(sorted.map((p) => p.title), ["A", "B", "C"]);
});

Deno.test("sortPages: by date desc", () => {
  const pages = [makePage("Old", "2020-01-01"), makePage("New", "2024-01-01"), makePage("Mid", "2022-01-01")];
  const sorted = sortPages(pages, "date", "desc");
  assertEquals(sorted.map((p) => p.title), ["New", "Mid", "Old"]);
});

Deno.test("sortPages: does not mutate original array", () => {
  const pages = [makePage("B"), makePage("A")];
  const copy = [...pages];
  sortPages(pages, "title", "asc");
  assertEquals(pages[0].title, copy[0].title);
});

// === groupByYear ===

Deno.test("groupByYear: groups pages by year", () => {
  const pages = [
    makePage("A", "2026-01-01"),
    makePage("B", "2026-07-01"),
    makePage("C", "2025-01-01"),
  ];
  const groups = groupByYear(pages);
  assertEquals(groups[2026].length, 2);
  assertEquals(groups[2025].length, 1);
});

Deno.test("groupByYear: pages without date go to key 0", () => {
  const pages = [makePage("NoDate")];
  const groups = groupByYear(pages);
  assertEquals(groups[0].length, 1);
});

Deno.test("groupByYear: all years present", () => {
  const pages = [
    makePage("A", "2024-01-01"),
    makePage("B", "2026-01-01"),
    makePage("C", "2025-01-01"),
  ];
  const keys = Object.keys(groupByYear(pages)).map(Number).sort((a, b) => b - a);
  assertEquals(keys, [2026, 2025, 2024]);
});

// === truncate ===

Deno.test("truncate: returns original when short enough", () => {
  assertEquals(truncate("Hello", 100), "Hello");
});

Deno.test("truncate: truncates at word boundary", () => {
  const result = truncate("Hello world, how are you?", 15);
  // Available = 14, "Hello world, h" → last space at 11 → "Hello world,"
  assertEquals(result, "Hello world,…");
});

Deno.test("truncate: uses custom suffix", () => {
  const result = truncate("Hello world", 8, "...");
  assertEquals(result.endsWith("..."), true);
});

Deno.test("truncate: exact length returns original", () => {
  assertEquals(truncate("Hello", 5), "Hello");
});

Deno.test("truncate: very short limit", () => {
  const result = truncate("Hello world", 1);
  assertEquals(result, "…");
});

// === getSearchUrl ===

Deno.test("getSearchUrl: encodes query and returns /search URL", () => {
  assertEquals(getSearchUrl("deno"), "/search?q=deno");
});

Deno.test("getSearchUrl: encodes spaces in query", () => {
  assertEquals(getSearchUrl("hello world"), "/search?q=hello%20world");
});

Deno.test("getSearchUrl: uses custom base path", () => {
  assertEquals(getSearchUrl("deno", "/en/search"), "/en/search?q=deno");
});

Deno.test("getSearchUrl: empty query produces empty q param", () => {
  assertEquals(getSearchUrl(""), "/search?q=");
});

Deno.test("getSearchUrl: encodes special characters", () => {
  assertEquals(getSearchUrl("a&b=c"), "/search?q=a%26b%3Dc");
});
