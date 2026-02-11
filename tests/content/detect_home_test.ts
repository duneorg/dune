/**
 * Tests for detectHomeSlug — autodetection of the home page folder.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { detectHomeSlug } from "../../src/content/index-builder.ts";
import type { PageIndex } from "../../src/content/types.ts";

/** Create a minimal PageIndex for testing */
function mockPage(overrides: Partial<PageIndex> & { sourcePath: string; route: string }): PageIndex {
  return {
    format: "md",
    template: "default",
    title: "Test",
    date: null,
    published: true,
    status: "published",
    visible: true,
    routable: true,
    isModule: false,
    order: 0,
    depth: 0,
    parentPath: null,
    taxonomy: {},
    mtime: Date.now(),
    hash: "abc",
    ...overrides,
  };
}

Deno.test("detectHomeSlug: finds first ordered top-level folder", () => {
  const pages = [
    mockPage({ sourcePath: "01.efficiency/default.md", route: "/efficiency", order: 1 }),
    mockPage({ sourcePath: "02.services/default.md", route: "/services", order: 2 }),
    mockPage({ sourcePath: "03.blog/blog.md", route: "/blog", order: 3 }),
  ];
  assertEquals(detectHomeSlug(pages), "efficiency");
});

Deno.test("detectHomeSlug: picks lowest order number", () => {
  const pages = [
    mockPage({ sourcePath: "03.blog/blog.md", route: "/blog", order: 3 }),
    mockPage({ sourcePath: "01.home/default.md", route: "/home", order: 1 }),
    mockPage({ sourcePath: "02.about/default.md", route: "/about", order: 2 }),
  ];
  assertEquals(detectHomeSlug(pages), "home");
});

Deno.test("detectHomeSlug: ignores nested pages", () => {
  const pages = [
    mockPage({ sourcePath: "02.blog/01.post/post.md", route: "/blog/post", order: 1, depth: 1 }),
    mockPage({ sourcePath: "03.services/default.md", route: "/services", order: 3, depth: 0 }),
  ];
  assertEquals(detectHomeSlug(pages), "services");
});

Deno.test("detectHomeSlug: falls back to 'home' when no ordered folders", () => {
  const pages = [
    mockPage({ sourcePath: "about/default.md", route: "/about", order: 0 }),
    mockPage({ sourcePath: "blog/blog.md", route: "/blog", order: 0 }),
  ];
  assertEquals(detectHomeSlug(pages), "home");
});

Deno.test("detectHomeSlug: falls back to 'home' with empty pages", () => {
  assertEquals(detectHomeSlug([]), "home");
});

Deno.test("detectHomeSlug: ignores depth > 0 even if ordered", () => {
  const pages = [
    mockPage({ sourcePath: "01.blog/01.intro/post.md", route: "/blog/intro", order: 1, depth: 1 }),
  ];
  // No top-level ordered pages → fallback
  assertEquals(detectHomeSlug(pages), "home");
});
