/**
 * Tests for content format handlers — registry, markdown, tsx.
 */

import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { FormatRegistry } from "../../src/content/formats/registry.ts";
import { MarkdownHandler } from "../../src/content/formats/markdown.ts";
import { TsxHandler } from "../../src/content/formats/tsx.ts";

// === FormatRegistry tests ===

Deno.test("FormatRegistry: register and lookup handler", () => {
  const registry = new FormatRegistry();
  const handler = new MarkdownHandler();
  registry.register(handler);

  assertEquals(registry.get(".md"), handler);
  assertEquals(registry.get("md"), handler); // without dot
  assertEquals(registry.supports(".md"), true);
  assertEquals(registry.supports(".tsx"), false);
});

Deno.test("FormatRegistry: getForFile extracts extension", () => {
  const registry = new FormatRegistry();
  registry.register(new MarkdownHandler());

  assertEquals(registry.getForFile("content/post.md") !== null, true);
  assertEquals(registry.getForFile("content/page.tsx"), null);
});

Deno.test("FormatRegistry: duplicate extension throws", () => {
  const registry = new FormatRegistry();
  registry.register(new MarkdownHandler());

  assertThrows(
    () => registry.register(new MarkdownHandler()),
    Error,
    "already registered",
  );
});

Deno.test("FormatRegistry: supportedExtensions returns all", () => {
  const registry = new FormatRegistry();
  registry.register(new MarkdownHandler());
  registry.register(new TsxHandler());

  const exts = registry.supportedExtensions();
  assertEquals(exts.includes(".md"), true);
  assertEquals(exts.includes(".tsx"), true);
});

// === MarkdownHandler tests ===

Deno.test("MarkdownHandler: extract frontmatter from markdown", async () => {
  const handler = new MarkdownHandler();
  const raw = `---
title: "Hello World"
date: "2025-06-15"
published: true
taxonomy:
  tag: [deno, fresh]
---

# Hello World

This is content.`;

  const fm = await handler.extractFrontmatter(raw, "test.md");
  assertEquals(fm.title, "Hello World");
  assertEquals(fm.date, "2025-06-15");
  assertEquals(fm.published, true);
  assertEquals(fm.taxonomy?.tag, ["deno", "fresh"]);
});

Deno.test("MarkdownHandler: extract body", () => {
  const handler = new MarkdownHandler();
  const raw = `---
title: "Test"
---

# Hello

Body here.`;

  const body = handler.extractBody(raw, "test.md");
  assertEquals(body, "# Hello\n\nBody here.");
});

Deno.test("MarkdownHandler: no frontmatter returns defaults", async () => {
  const handler = new MarkdownHandler();
  const raw = `# Just Content\n\nNo frontmatter here.`;

  const fm = await handler.extractFrontmatter(raw, "test.md");
  assertEquals(fm.title, "");
  assertEquals(fm.published, true);
  assertEquals(fm.visible, true);
  assertEquals(fm.routable, true);
});

Deno.test("MarkdownHandler: empty body returns null", () => {
  const handler = new MarkdownHandler();
  const raw = `---
title: "Test"
---`;

  const body = handler.extractBody(raw, "test.md");
  assertEquals(body, null);
});

// === TsxHandler tests ===

Deno.test("TsxHandler: extract frontmatter from source", async () => {
  const handler = new TsxHandler();
  const raw = `
export const frontmatter = {
  title: "Landing Page",
  date: "2025-06-15",
  published: true,
  taxonomy: {
    tag: ["deno", "fresh"],
    category: ["showcase"],
  },
};

export default function Page() {
  return <h1>Hello</h1>;
}`;

  const fm = await handler.extractFrontmatter(raw, "/tmp/test/page.tsx");
  assertEquals(fm.title, "Landing Page");
  assertEquals(fm.date, "2025-06-15");
  assertEquals(fm.published, true);
  assertEquals(fm.taxonomy?.tag, ["deno", "fresh"]);
});

Deno.test("TsxHandler: no frontmatter returns defaults", async () => {
  const handler = new TsxHandler();
  const raw = `
export default function Page() {
  return <h1>Hello</h1>;
}`;

  const fm = await handler.extractFrontmatter(raw, "/tmp/test/page.tsx");
  assertEquals(fm.title, "");
  assertEquals(fm.published, true);
});

Deno.test("TsxHandler: extractBody returns null (tsx is self-rendering)", () => {
  const handler = new TsxHandler();
  const body = handler.extractBody("any content", "page.tsx");
  assertEquals(body, null);
});

Deno.test("TsxHandler: handles comments in frontmatter object", async () => {
  const handler = new TsxHandler();
  const raw = `
export const frontmatter = {
  title: "Test Page",
  // Layout control
  layout: "landing",
  published: true,
};

export default function Page() {
  return <h1>Hello</h1>;
}`;

  const fm = await handler.extractFrontmatter(raw, "/tmp/test/page.tsx");
  assertEquals(fm.title, "Test Page");
  assertEquals(fm.layout, "landing");
});

Deno.test("TsxHandler: handles nested objects", async () => {
  const handler = new TsxHandler();
  const raw = `
export const frontmatter = {
  title: "Test",
  metadata: {
    description: "A test page",
  },
  taxonomy: {
    tag: ["a", "b"],
  },
};

export default function Page() {
  return <div />;
}`;

  const fm = await handler.extractFrontmatter(raw, "/tmp/test/page.tsx");
  assertEquals(fm.title, "Test");
  assertEquals(fm.metadata?.description, "A test page");
  assertEquals(fm.taxonomy?.tag, ["a", "b"]);
});
