/**
 * Regression tests for onMarkdownProcess/onMarkdownProcessed (0.31.7),
 * fired from MarkdownHandler.renderToHtml() when ctx.hooks is present.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { MarkdownHandler } from "../../../src/content/formats/markdown.ts";
import { createHookRegistry } from "../../../src/hooks/registry.ts";
import type { Page, RenderContext } from "../../../src/content/types.ts";
import type { DuneConfig } from "../../../src/config/types.ts";
import type { StorageAdapter } from "../../../src/storage/types.ts";

const stubStorage = {} as StorageAdapter;
const stubConfig = {} as DuneConfig;

function makePage(overrides: Partial<Page> = {}): Page {
  return {
    sourcePath: "01.home/default.md",
    route: "/",
    language: "en",
    format: "md",
    template: "default",
    navTitle: "Home",
    frontmatter: { title: "Home" },
    rawContent: "Hello {{name}}",
    html: () => Promise.resolve(""),
    component: () => Promise.resolve(null),
    handlers: () => Promise.resolve(null),
    media: [],
    order: 1,
    depth: 0,
    isModule: false,
    modules: () => Promise.resolve([]),
    parent: () => Promise.resolve(null),
    children: () => Promise.resolve([]),
    siblings: () => Promise.resolve([]),
    summary: () => Promise.resolve(""),
    ...overrides,
  };
}

function makeCtx(overrides: Partial<RenderContext> = {}): RenderContext {
  return {
    media: { url: (f: string) => `/media/${f}`, get: () => null, list: () => [] },
    params: {},
    ...overrides,
  };
}

Deno.test("MarkdownHandler.renderToHtml: fires onMarkdownProcess with raw + page, honors setData", async () => {
  const hooks = createHookRegistry({ config: stubConfig, storage: stubStorage });
  let seenRaw: string | undefined;
  hooks.on("onMarkdownProcess", (ctx) => {
    const data = ctx.data as { raw: string; page: Page };
    seenRaw = data.raw;
    ctx.setData({ ...data, raw: data.raw.replace("{{name}}", "World") });
  });

  const handler = new MarkdownHandler();
  const page = makePage({ rawContent: "Hello {{name}}" });
  const html = await handler.renderToHtml(page, makeCtx({ hooks, trustedHtml: true }));

  assertEquals(seenRaw, "Hello {{name}}");
  assertEquals(html.includes("Hello World"), true);
});

Deno.test("MarkdownHandler.renderToHtml: fires onMarkdownProcessed with the final html, honors setData", async () => {
  const hooks = createHookRegistry({ config: stubConfig, storage: stubStorage });
  let seenHtml: string | undefined;
  hooks.on("onMarkdownProcessed", (ctx) => {
    const data = ctx.data as { html: string; page: Page };
    seenHtml = data.html;
    ctx.setData({ ...data, html: data.html + "<!-- processed -->" });
  });

  const handler = new MarkdownHandler();
  const page = makePage({ rawContent: "Body text" });
  const html = await handler.renderToHtml(page, makeCtx({ hooks, trustedHtml: true }));

  assertEquals(seenHtml?.includes("Body text"), true);
  assertEquals(html.endsWith("<!-- processed -->"), true);
});

Deno.test("MarkdownHandler.renderToHtml: does not fire hooks when ctx.hooks is absent (backward compatible)", async () => {
  const handler = new MarkdownHandler();
  const page = makePage({ rawContent: "Plain body" });
  const html = await handler.renderToHtml(page, makeCtx({ trustedHtml: true }));

  assertEquals(html.includes("Plain body"), true);
});
