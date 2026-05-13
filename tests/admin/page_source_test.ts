/**
 * Tests for GET /admin/api/page-source — raw page content endpoint.
 *
 * Tests the route handler directly with stub engine and storage objects.
 */

import {
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { PageIndex } from "../../src/content/types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SAMPLE_CONTENT = `---
title: Hello World
published: true
date: 2026-01-01
---

# Hello World

This is a test page.
`;

function makePageIndex(overrides: Partial<PageIndex> = {}): PageIndex {
  return {
    sourcePath: "01.blog/01.hello/default.md",
    route: "/blog/hello",
    language: "en",
    format: "md",
    template: "default",
    title: "Hello World",
    navTitle: "Hello World",
    date: "2026-01-01",
    published: true,
    status: "published",
    visible: true,
    routable: true,
    isModule: false,
    order: 1,
    depth: 1,
    parentPath: null,
    taxonomy: {},
    mtime: 1700000000000,
    hash: "abc",
    ...overrides,
  };
}

function makeCtx(route: string | null, pages: PageIndex[], storageContent?: string) {
  const url = new URL(
    `http://localhost/admin/api/page-source${route !== null ? `?route=${encodeURIComponent(route)}` : ""}`,
  );

  return {
    req: new Request(url.href, { method: "GET", headers: { host: "localhost" } }),
    url,
    state: {
      auth: { authenticated: true, user: { id: "1", role: "admin" } },
      adminContext: {
        auth: {
          hasPermission: (_auth: unknown, _perm: string) => true,
        },
        auditLogger: null,
        engine: {
          pages,
        },
        storage: {
          async read(_path: string): Promise<Uint8Array> {
            if (storageContent === undefined) {
              throw new Error("File not found");
            }
            return new TextEncoder().encode(storageContent);
          },
        },
        config: {
          system: {
            content: { dir: "content" },
          },
        },
      },
    },
    next: () => new Response("not found", { status: 404 }),
  };
}

async function callPageSource(
  route: string | null,
  pages: PageIndex[],
  storageContent?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { handler } = await import("../../src/admin/routes/api/page-source.ts");
  const ctx = makeCtx(route, pages, storageContent);
  const res = await (handler as { GET: (ctx: unknown) => Promise<Response> }).GET(ctx);
  const body = await res.json();
  return { status: res.status, body };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test("page-source: returns raw content and parsed frontmatter", async () => {
  const pages = [makePageIndex()];
  const { status, body } = await callPageSource("/blog/hello", pages, SAMPLE_CONTENT);

  assertEquals(status, 200);
  assertEquals(body.route, "/blog/hello");
  assertEquals(body.sourcePath, "01.blog/01.hello/default.md");
  assertEquals(body.format, "md");
  assertStringIncludes(body.content as string, "title: Hello World");
  assertStringIncludes(body.body as string, "# Hello World");

  const fm = body.frontmatter as Record<string, unknown>;
  assertEquals(fm.title, "Hello World");
  assertEquals(fm.published, true);
});

Deno.test("page-source: returns 400 when route param is missing", async () => {
  const { status, body } = await callPageSource(null, []);

  assertEquals(status, 400);
  assertExists(body.error);
});

Deno.test("page-source: returns 404 for unknown route", async () => {
  const pages = [makePageIndex({ route: "/blog/hello" })];
  const { status, body } = await callPageSource("/nonexistent", pages, SAMPLE_CONTENT);

  assertEquals(status, 404);
  assertExists(body.error);
  assertStringIncludes(body.error as string, "/nonexistent");
});

Deno.test("page-source: returns 404 when storage read fails", async () => {
  const pages = [makePageIndex()];
  const { status, body } = await callPageSource("/blog/hello", pages, undefined);

  assertEquals(status, 404);
  assertExists(body.error);
});

Deno.test("page-source: normalizes route without leading slash", async () => {
  const pages = [makePageIndex({ route: "/blog/hello" })];
  const { status, body } = await callPageSource("blog/hello", pages, SAMPLE_CONTENT);

  assertEquals(status, 200);
  assertEquals(body.route, "/blog/hello");
});

Deno.test("page-source: returns mtime from page index", async () => {
  const pages = [makePageIndex({ mtime: 1700000000000 })];
  const { status, body } = await callPageSource("/blog/hello", pages, SAMPLE_CONTENT);

  assertEquals(status, 200);
  assertEquals(body.mtime, 1700000000000);
});

Deno.test("page-source: returns null body for tsx format", async () => {
  const pages = [makePageIndex({ format: "tsx", sourcePath: "01.page/default.tsx" })];
  const tsxContent = 'export default function Page() { return <div>Hello</div>; }';
  const { status, body } = await callPageSource("/blog/hello", pages, tsxContent);

  assertEquals(status, 200);
  assertEquals(body.body, null);
  assertEquals(body.content, tsxContent);
});

Deno.test("page-source: handles content without frontmatter", async () => {
  const pages = [makePageIndex()];
  const rawMd = "# No Frontmatter\n\nJust a body.";
  const { status, body } = await callPageSource("/blog/hello", pages, rawMd);

  assertEquals(status, 200);
  assertEquals(body.frontmatter, {});
  assertStringIncludes(body.body as string, "No Frontmatter");
});
