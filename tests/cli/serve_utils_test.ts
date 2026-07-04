/**
 * Tests for shared HTTP-serving utilities.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isAdminPath, injectBasePath } from "../../src/cli/serve-utils.ts";

async function bodyOf(response: Response): Promise<string> {
  return await response.text();
}

function htmlResponse(html: string): Response {
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

Deno.test("isAdminPath: matches the admin root and nested paths", () => {
  assertEquals(isAdminPath("/admin", "/admin"), true);
  assertEquals(isAdminPath("/admin/pages", "/admin"), true);
  assertEquals(isAdminPath("/admin/api/content/x", "/admin"), true);
});

Deno.test("isAdminPath: does not match sibling routes sharing the prefix string", () => {
  assertEquals(isAdminPath("/administrivia", "/admin"), false);
  assertEquals(isAdminPath("/admin-blog", "/admin"), false);
  assertEquals(isAdminPath("/", "/admin"), false);
  assertEquals(isAdminPath("/about", "/admin"), false);
});

Deno.test("isAdminPath: respects custom admin prefixes", () => {
  assertEquals(isAdminPath("/backstage", "/backstage"), true);
  assertEquals(isAdminPath("/backstage/users", "/backstage"), true);
  assertEquals(isAdminPath("/backstage-door", "/backstage"), false);
});

// === injectBasePath (multisite path_prefix routing) ===

Deno.test("injectBasePath: no-op when basePath is unset", async () => {
  const res = injectBasePath(htmlResponse('<a href="/blog">Blog</a>'), undefined);
  assertEquals(await bodyOf(res), '<a href="/blog">Blog</a>');
});

Deno.test("injectBasePath: no-op for non-HTML responses", async () => {
  const res = injectBasePath(
    new Response('<a href="/blog">Blog</a>', { headers: { "Content-Type": "application/json" } }),
    "/papermod",
  );
  assertEquals(await bodyOf(res), '<a href="/blog">Blog</a>');
});

Deno.test("injectBasePath: prefixes root-relative href/src/action", async () => {
  const html = '<a href="/">Home</a><a href="/blog/post">Post</a>' +
    '<link href="/themes/papermod/static/style.css" rel="stylesheet">' +
    '<form action="/search"></form>';
  const res = injectBasePath(htmlResponse(html), "/papermod");
  const out = await bodyOf(res);

  assertEquals(
    out,
    '<a href="/papermod/">Home</a><a href="/papermod/blog/post">Post</a>' +
      '<link href="/papermod/themes/papermod/static/style.css" rel="stylesheet">' +
      '<form action="/papermod/search"></form>',
  );
});

Deno.test("injectBasePath: leaves absolute and protocol-relative URLs untouched", async () => {
  const html = '<a href="https://example.com/x">abs</a><a href="//cdn.example.com/x">proto-relative</a>' +
    '<a href="mailto:hi@example.com">mail</a>';
  const res = injectBasePath(htmlResponse(html), "/papermod");
  assertEquals(await bodyOf(res), html);
});

Deno.test("injectBasePath: is idempotent — doesn't double-prefix already-prefixed paths", async () => {
  const html = '<a href="/papermod/blog/post">Post</a>';
  const res = injectBasePath(htmlResponse(html), "/papermod");
  assertEquals(await bodyOf(res), html);
});

Deno.test("injectBasePath: normalizes a trailing slash on basePath", async () => {
  const res = injectBasePath(htmlResponse('<a href="/blog">Blog</a>'), "/papermod/");
  assertEquals(await bodyOf(res), '<a href="/papermod/blog">Blog</a>');
});
