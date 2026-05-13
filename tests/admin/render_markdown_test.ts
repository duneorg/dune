/**
 * Tests for POST /admin/api/render-markdown — markdown rendering endpoint.
 *
 * Tests the route handler directly with minimal FreshContext stubs.
 * No filesystem access — all tests operate on in-memory content strings.
 */

import {
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

async function callRenderMarkdown(body: unknown): Promise<Record<string, unknown>> {
  const { handler } = await import(
    "../../src/admin/routes/api/render-markdown.ts"
  );

  const req = new Request("http://localhost/admin/api/render-markdown", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "origin": "http://localhost",
      "host": "localhost",
    },
    body: JSON.stringify(body),
  });

  const ctx = {
    req,
    url: new URL(req.url),
    state: {
      auth: { authenticated: true, user: { id: "1", role: "admin" } },
      adminContext: {
        auth: {
          hasPermission: (_auth: unknown, _perm: string) => true,
        },
        auditLogger: null,
        config: {
          system: { debug: false },
        },
      },
    },
    next: () => new Response("not found", { status: 404 }),
  };

  const res = await (handler as { POST: (ctx: unknown) => Promise<Response> }).POST(ctx);
  return await res.json() as Record<string, unknown>;
}

// ---------------------------------------------------------------------------

Deno.test("render-markdown: renders plain markdown to HTML", async () => {
  const result = await callRenderMarkdown({
    content: "# Hello\n\nThis is a paragraph.",
  });

  assertExists(result.html);
  assertStringIncludes(result.html as string, "<h1>Hello</h1>");
  assertStringIncludes(result.html as string, "<p>This is a paragraph.</p>");
  assertEquals(result.frontmatter, {});
  assertEquals((result.warnings as string[]).length, 0);
});

Deno.test("render-markdown: parses frontmatter and separates body", async () => {
  const result = await callRenderMarkdown({
    content: "---\ntitle: My Page\npublished: true\n---\n\n# Content\n\nBody text.",
  });

  const fm = result.frontmatter as Record<string, unknown>;
  assertEquals(fm.title, "My Page");
  assertEquals(fm.published, true);
  assertStringIncludes(result.html as string, "<h1>Content</h1>");
  // frontmatter should not appear in HTML
  assertEquals((result.html as string).includes("title:"), false);
});

Deno.test("render-markdown: reports YAML parse error as warning", async () => {
  const result = await callRenderMarkdown({
    content: "---\ntitle: [unclosed bracket\n---\n\nBody text.",
  });

  const warnings = result.warnings as string[];
  assertEquals(warnings.length > 0, true);
  assertEquals(warnings.some((w) => w.toLowerCase().includes("yaml")), true);
  assertEquals(result.frontmatter, {});
});

Deno.test("render-markdown: sanitizes script tags by default", async () => {
  const result = await callRenderMarkdown({
    content: '<script>alert("xss")</script>\n\nNormal text.',
  });

  const html = result.html as string;
  assertEquals(html.includes("<script>"), false);
  assertStringIncludes(html, "Normal text");
});

Deno.test("render-markdown: allows raw HTML when trusted=true", async () => {
  const result = await callRenderMarkdown({
    content: "<strong>Bold</strong> text.",
    trusted: true,
  });

  assertStringIncludes(result.html as string, "<strong>Bold</strong>");
});

Deno.test("render-markdown: adds loading=lazy to images", async () => {
  const result = await callRenderMarkdown({
    content: "![alt text](photo.jpg)",
  });

  assertStringIncludes(result.html as string, 'loading="lazy"');
});

Deno.test("render-markdown: returns 400 when content is missing", async () => {
  const { handler } = await import(
    "../../src/admin/routes/api/render-markdown.ts"
  );

  const req = new Request("http://localhost/admin/api/render-markdown", {
    method: "POST",
    headers: { "Content-Type": "application/json", origin: "http://localhost", host: "localhost" },
    body: JSON.stringify({ other: "field" }),
  });

  const ctx = {
    req,
    url: new URL(req.url),
    state: {
      auth: { authenticated: true, user: { id: "1", role: "admin" } },
      adminContext: {
        auth: { hasPermission: () => true },
        auditLogger: null,
        config: { system: { debug: false } },
      },
    },
    next: () => new Response("not found", { status: 404 }),
  };

  const res = await (handler as { POST: (ctx: unknown) => Promise<Response> }).POST(ctx);
  assertEquals(res.status, 400);
  const body = await res.json();
  assertExists(body.error);
});

Deno.test("render-markdown: handles unclosed frontmatter block gracefully", async () => {
  const result = await callRenderMarkdown({
    content: "---\ntitle: Missing close\n\nSome content here.",
  });

  const warnings = result.warnings as string[];
  assertEquals(warnings.some((w) => w.includes("---")), true);
});

Deno.test("render-markdown: renders markdown with code blocks", async () => {
  const result = await callRenderMarkdown({
    content: "```typescript\nconst x = 1;\n```",
  });

  assertStringIncludes(result.html as string, "<code");
  assertStringIncludes(result.html as string, "const x = 1;");
});

Deno.test("render-markdown: empty content returns empty html", async () => {
  const result = await callRenderMarkdown({ content: "" });
  assertEquals((result.html as string).trim(), "");
  assertEquals(result.frontmatter, {});
});
