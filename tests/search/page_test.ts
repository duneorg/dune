import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { generateSearchPage } from "../../src/search/page.ts";
import type { SearchPageOptions } from "../../src/search/page.ts";

function makeOptions(overrides: Partial<SearchPageOptions> = {}): SearchPageOptions {
  return {
    query: "",
    results: [],
    site: {
      title: "My Site",
      description: "A test site",
      url: "https://example.com",
      author: { name: "Author" },
      metadata: {},
      taxonomies: [],
      routes: {},
      redirects: {},
    },
    siteUrl: "https://example.com",
    ...overrides,
  };
}

Deno.test("generateSearchPage: returns complete HTML document", () => {
  const html = generateSearchPage(makeOptions());

  assertStringIncludes(html, "<!DOCTYPE html>");
  assertStringIncludes(html, "<html");
  assertStringIncludes(html, "</html>");
  assertStringIncludes(html, "<head>");
  assertStringIncludes(html, "<body>");
});

Deno.test("generateSearchPage: title includes site name", () => {
  const html = generateSearchPage(makeOptions({ site: makeOptions().site }));

  assertStringIncludes(html, "My Site");
});

Deno.test("generateSearchPage: title includes query when present", () => {
  const html = generateSearchPage(makeOptions({ query: "deno" }));

  assertStringIncludes(html, "Search: deno");
});

Deno.test("generateSearchPage: form action is /search", () => {
  const html = generateSearchPage(makeOptions());

  assertStringIncludes(html, 'action="/search"');
});

Deno.test("generateSearchPage: input value is pre-filled with query", () => {
  const html = generateSearchPage(makeOptions({ query: "hello world" }));

  assertStringIncludes(html, 'value="hello world"');
});

Deno.test("generateSearchPage: empty query shows no empty-state message", () => {
  const html = generateSearchPage(makeOptions({ query: "" }));

  // Empty state should be hidden
  assertStringIncludes(html, 'style="display:none"');
});

Deno.test("generateSearchPage: query with no results shows empty-state message", () => {
  const html = generateSearchPage(makeOptions({ query: "xyz", results: [] }));

  assertStringIncludes(html, "No results found");
  assertStringIncludes(html, "xyz");
});

Deno.test("generateSearchPage: results are rendered as list items", () => {
  const results = [
    { route: "/blog/post-1", title: "First Post", excerpt: "About the first post", score: 5 },
    { route: "/blog/post-2", title: "Second Post", excerpt: "About the second post", score: 3 },
  ];
  const html = generateSearchPage(makeOptions({ query: "post", results }));

  assertStringIncludes(html, "First Post");
  assertStringIncludes(html, "Second Post");
  assertStringIncludes(html, "/blog/post-1");
  assertStringIncludes(html, "/blog/post-2");
  assertStringIncludes(html, "About the first post");
});

Deno.test("generateSearchPage: result title links to page route with full URL", () => {
  const results = [{ route: "/hello", title: "Hello", excerpt: "Excerpt", score: 1 }];
  const html = generateSearchPage(makeOptions({ query: "hello", results }));

  assertStringIncludes(html, 'href="https://example.com/hello"');
});

Deno.test("generateSearchPage: escapes HTML special chars in query", () => {
  const html = generateSearchPage(makeOptions({ query: '<script>alert("xss")</script>' }));

  assertEquals(html.includes("<script>alert"), false);
  assertStringIncludes(html, "&lt;script&gt;");
});

Deno.test("generateSearchPage: escapes HTML special chars in result title", () => {
  const results = [{ route: "/safe", title: "A & B <em>test</em>", excerpt: "excerpt", score: 1 }];
  const html = generateSearchPage(makeOptions({ query: "test", results }));

  assertEquals(html.includes("A & B <em>"), false);
  assertStringIncludes(html, "A &amp; B &lt;em&gt;");
});

Deno.test("generateSearchPage: includes inline JS for live search", () => {
  const html = generateSearchPage(makeOptions());

  assertStringIncludes(html, "<script>");
  assertStringIncludes(html, "/api/search");
  assertStringIncludes(html, "debounceTimer");
});

Deno.test("generateSearchPage: back link points to site home", () => {
  const html = generateSearchPage(makeOptions({ siteUrl: "https://example.com" }));

  assertStringIncludes(html, 'href="https://example.com/"');
});
