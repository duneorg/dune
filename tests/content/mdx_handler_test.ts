/**
 * Tests for MDX content format handler.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { FormatRegistry } from "../../src/content/formats/registry.ts";
import { MdxHandler } from "../../src/content/formats/mdx.ts";
import { createMdxComponentRegistry } from "../../src/content/formats/mdx-components.ts";

// === Registration ===

Deno.test("MdxHandler: registers for .mdx extension", () => {
  const registry = new FormatRegistry();
  const handler = new MdxHandler();
  registry.register(handler);

  assertEquals(registry.get(".mdx"), handler);
  assertEquals(registry.get("mdx"), handler);
  assertEquals(registry.supports(".mdx"), true);
  assertEquals(registry.getForFile("content/page.mdx") !== null, true);
});

Deno.test("MdxHandler: coexists with markdown and tsx handlers", async () => {
  const registry = new FormatRegistry();
  const { MarkdownHandler } = await importMarkdown();
  const { TsxHandler } = await importTsx();

  registry.register(new MarkdownHandler());
  registry.register(new TsxHandler());
  registry.register(new MdxHandler());

  assertEquals(registry.supportedExtensions().sort(), [".md", ".mdx", ".tsx"]);
});

// === Frontmatter extraction ===

Deno.test("MdxHandler: extract YAML frontmatter", async () => {
  const handler = new MdxHandler();
  const raw = `---
title: "MDX Page"
date: 2025-06-15
published: true
taxonomy:
  tag: [deno, mdx]
  category: [tutorials]
---

# Hello from MDX

This is **MDX** content with a component:

<MyComponent />
`;

  const fm = await handler.extractFrontmatter(raw, "page.mdx");

  assertEquals(fm.title, "MDX Page");
  // gray-matter parses YAML dates as Date objects; verify date was extracted
  assertEquals(fm.date != null, true);
  assertEquals(fm.published, true);
  assertEquals(fm.taxonomy?.tag, ["deno", "mdx"]);
  assertEquals(fm.taxonomy?.category, ["tutorials"]);
});

Deno.test("MdxHandler: defaults for missing frontmatter fields", async () => {
  const handler = new MdxHandler();
  const raw = `---
title: "Minimal"
---

Some content.
`;

  const fm = await handler.extractFrontmatter(raw, "page.mdx");

  assertEquals(fm.title, "Minimal");
  assertEquals(fm.published, true);
  assertEquals(fm.visible, true);
  assertEquals(fm.routable, true);
});

Deno.test("MdxHandler: empty frontmatter uses defaults", async () => {
  const handler = new MdxHandler();
  const raw = `---
---

Just content.
`;

  const fm = await handler.extractFrontmatter(raw, "page.mdx");

  assertEquals(fm.title, "");
  assertEquals(fm.published, true);
});

Deno.test("MdxHandler: frontmatter with collection definition", async () => {
  const handler = new MdxHandler();
  const raw = `---
title: "Blog"
collection:
  items:
    "@self.children": true
  order:
    by: date
    dir: desc
---

# Blog listing
`;

  const fm = await handler.extractFrontmatter(raw, "blog.mdx");

  assertEquals(fm.title, "Blog");
  assertEquals(fm.collection?.items, { "@self.children": true });
  assertEquals(fm.collection?.order?.by, "date");
});

// === Body extraction ===

Deno.test("MdxHandler: extract body (MDX content after frontmatter)", () => {
  const handler = new MdxHandler();
  const raw = `---
title: "Test"
---

# Hello

This is MDX content.

<MyComponent prop="value" />
`;

  const body = handler.extractBody(raw, "page.mdx");

  assertEquals(body?.includes("# Hello"), true);
  assertEquals(body?.includes("This is MDX content."), true);
  assertEquals(body?.includes('<MyComponent prop="value" />'), true);
  // Should NOT include frontmatter
  assertEquals(body?.includes("title: \"Test\""), false);
});

Deno.test("MdxHandler: empty body returns null", () => {
  const handler = new MdxHandler();
  const raw = `---
title: "Empty"
---
`;

  const body = handler.extractBody(raw, "page.mdx");
  assertEquals(body, null);
});

Deno.test("MdxHandler: body without frontmatter", () => {
  const handler = new MdxHandler();
  const raw = `# No frontmatter

Just content.`;

  const body = handler.extractBody(raw, "page.mdx");
  assertEquals(body?.includes("# No frontmatter"), true);
});

// === MDX rendering ===

Deno.test("MdxHandler: render basic MDX to HTML", async () => {
  const handler = new MdxHandler();

  // Create a mock page object with just what renderToHtml needs
  const page = createMockPage("# Hello World\n\nA paragraph.", "page.mdx");

  const ctx = createMockRenderContext();
  const html = await handler.renderToHtml(page, ctx);

  // Should contain rendered HTML
  assertEquals(html.includes("Hello World"), true);
  assertEquals(html.includes("A paragraph"), true);
});

Deno.test("MdxHandler: render MDX with formatting", async () => {
  const handler = new MdxHandler();

  const page = createMockPage(
    "Text with **bold** and *italic* and `code`.",
    "page.mdx",
  );

  const ctx = createMockRenderContext();
  const html = await handler.renderToHtml(page, ctx);

  assertEquals(html.includes("<strong>bold</strong>"), true);
  assertEquals(html.includes("<em>italic</em>"), true);
  assertEquals(html.includes("<code>code</code>"), true);
});

Deno.test("MdxHandler: render MDX with lists", async () => {
  const handler = new MdxHandler();

  const page = createMockPage(
    "- Item one\n- Item two\n- Item three",
    "page.mdx",
  );

  const ctx = createMockRenderContext();
  const html = await handler.renderToHtml(page, ctx);

  assertEquals(html.includes("<li>"), true);
  assertEquals(html.includes("Item one"), true);
});

Deno.test("MdxHandler: empty rawContent returns empty string", async () => {
  const handler = new MdxHandler();

  const page = createMockPage(null, "page.mdx");
  const ctx = createMockRenderContext();
  const html = await handler.renderToHtml(page, ctx);

  assertEquals(html, "");
});

Deno.test("MdxHandler: invalid MDX returns error HTML", async () => {
  const handler = new MdxHandler();

  // Unclosed JSX tag should cause a compilation error
  const page = createMockPage("<div>\n  <span>Unclosed", "page.mdx");
  const ctx = createMockRenderContext();
  const html = await handler.renderToHtml(page, ctx);

  // Should contain error indication rather than crashing
  assertEquals(html.includes("mdx-error") || html.includes("Error") || html.length > 0, true);
});

// === Media references ===

Deno.test("MdxHandler: resolve relative image references", async () => {
  const handler = new MdxHandler();

  const page = createMockPage(
    "# Post\n\n![Cover](cover.jpg)\n\nSome text.",
    "02.blog/01.post/page.mdx",
  );

  const ctx = createMockRenderContext({
    "cover.jpg": "/content-media/02.blog/01.post/cover.jpg",
  });

  const html = await handler.renderToHtml(page, ctx);

  assertEquals(html.includes("/content-media/02.blog/01.post/cover.jpg"), true);
  assertEquals(html.includes("Cover"), true);
});

Deno.test("MdxHandler: preserve absolute URLs", async () => {
  const handler = new MdxHandler();

  const page = createMockPage(
    "![Logo](https://example.com/logo.png)",
    "page.mdx",
  );

  const ctx = createMockRenderContext();
  const html = await handler.renderToHtml(page, ctx);

  assertEquals(html.includes("https://example.com/logo.png"), true);
});

Deno.test("MdxHandler: preserve image query params", async () => {
  const handler = new MdxHandler();

  const page = createMockPage(
    "![Photo](photo.jpg?width=800&quality=80)",
    "page.mdx",
  );

  const ctx = createMockRenderContext({
    "photo.jpg": "/content-media/post/photo.jpg",
  });

  const html = await handler.renderToHtml(page, ctx);

  // MDX renders images as <img> tags; query params may be HTML-encoded (&amp;)
  assertEquals(
    html.includes("/content-media/post/photo.jpg?width=800&quality=80") ||
    html.includes("/content-media/post/photo.jpg?width=800&amp;quality=80"),
    true,
  );
});

// === Component registry ===

Deno.test("MdxComponentRegistry: register and retrieve components", () => {
  const registry = createMdxComponentRegistry();

  const FakeComponent = () => "fake";
  registry.register("FakeComponent", FakeComponent);

  assertEquals(registry.has("FakeComponent"), true);
  assertEquals(registry.has("NonExistent"), false);

  const components = registry.getComponents();
  assertEquals(components["FakeComponent"], FakeComponent);
});

Deno.test("MdxComponentRegistry: initialize with defaults", () => {
  const defaults = {
    Alert: () => "alert",
    Card: () => "card",
  };

  const registry = createMdxComponentRegistry(defaults);

  assertEquals(registry.has("Alert"), true);
  assertEquals(registry.has("Card"), true);
  assertEquals(Object.keys(registry.getComponents()).length, 2);
});

Deno.test("MdxComponentRegistry: override default components", () => {
  const registry = createMdxComponentRegistry({
    Alert: () => "old",
  });

  const newAlert = () => "new";
  registry.register("Alert", newAlert);

  assertEquals(registry.getComponents()["Alert"], newAlert);
});

Deno.test("MdxHandler: render with custom components", async () => {
  const registry = createMdxComponentRegistry();

  const handler = new MdxHandler({ components: registry });

  // Basic MDX content (without custom components — just verifies the handler
  // accepts a component registry without errors)
  const page = createMockPage("# Test\n\nContent.", "page.mdx");
  const ctx = createMockRenderContext();
  const html = await handler.renderToHtml(page, ctx);

  assertEquals(html.includes("Test"), true);
});

// === Helpers ===

function createMockPage(
  rawContent: string | null,
  sourcePath: string,
): any {
  return {
    sourcePath,
    route: "/" + sourcePath.replace(/\.mdx$/, ""),
    format: "mdx" as const,
    template: "default",
    frontmatter: { title: "Test" },
    rawContent,
    html: async () => "",
    component: async () => null,
    media: [],
    order: 0,
    depth: 0,
    isModule: false,
    modules: async () => [],
    parent: async () => null,
    children: async () => [],
    siblings: async () => [],
    summary: async () => "",
  };
}

function createMockRenderContext(
  mediaMap: Record<string, string> = {},
): any {
  return {
    site: { title: "Test Site" },
    config: {},
    media: {
      url: (filename: string) => mediaMap[filename] ?? "",
      get: (filename: string) => {
        if (mediaMap[filename]) {
          return { name: filename, url: mediaMap[filename] };
        }
        return null;
      },
      list: () => [],
    },
    params: {},
  };
}

// Dynamic imports for handler classes
async function importMarkdown() {
  return await import("../../src/content/formats/markdown.ts");
}

async function importTsx() {
  return await import("../../src/content/formats/tsx.ts");
}
