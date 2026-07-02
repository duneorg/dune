/** @jsxImportSource preact */
import { assertEquals, assertStringIncludes } from "@std/assert";
import { h } from "preact";
import { render as renderToString } from "preact-render-to-string";
import { resolveTemplateVNode } from "../../src/themes/resolve-template.ts";

function SyncTemplate({ title }: { title: string }) {
  return h("h1", null, title);
}

async function AsyncTemplate({ page }: { page: { html: () => Promise<string> } }) {
  const html = await page.html();
  return h("article", { dangerouslySetInnerHTML: { __html: html } });
}

Deno.test("resolveTemplateVNode — sync component renders normally", async () => {
  const vnode = await resolveTemplateVNode(SyncTemplate, { title: "Hello" });
  assertEquals(renderToString(vnode as Parameters<typeof renderToString>[0]), "<h1>Hello</h1>");
});

Deno.test("resolveTemplateVNode — async component is awaited before render", async () => {
  const page = { html: () => Promise.resolve("<p>from page.html()</p>") };
  const vnode = await resolveTemplateVNode(
    AsyncTemplate as unknown as Parameters<typeof resolveTemplateVNode>[0],
    { page },
  );
  const out = renderToString(vnode as Parameters<typeof renderToString>[0]);
  assertStringIncludes(out, "<p>from page.html()</p>");
  assertStringIncludes(out, "<article>");
});
