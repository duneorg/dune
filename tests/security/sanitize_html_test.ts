/**
 * Regression tests for the HTML sanitizer — one test per attack class from
 * the 2026-04-17 audit.
 */

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { sanitizeHtml } from "../../src/security/sanitize-html.ts";

function assertNoScript(s: string, input: string) {
  const lower = s.toLowerCase();
  if (/<script|javascript:|onerror=|onload=|onclick=/i.test(lower)) {
    throw new Error(`Unsanitized output for input: ${input}\nGot: ${s}`);
  }
}

Deno.test("strips <script> tags entirely", () => {
  const out = sanitizeHtml(`hello<script>alert(1)</script>world`);
  assertEquals(out, "helloworld");
  assertNoScript(out, "<script>");
});

Deno.test("strips <script> with attributes and nested markup", () => {
  const out = sanitizeHtml(`<p>safe</p><script type="text/javascript">var x = "<b>bold</b>"; alert(x);</script><p>after</p>`);
  assertEquals(out, "<p>safe</p><p>after</p>");
});

Deno.test("strips on* event handlers", () => {
  const out = sanitizeHtml(`<img src="/ok.png" onerror="alert(1)" alt="x">`);
  assertEquals(out, `<img src="/ok.png" alt="x">`);
});

Deno.test("strips onclick on links", () => {
  const out = sanitizeHtml(`<a href="/x" onclick="alert(1)">click</a>`);
  assertEquals(out, `<a href="/x">click</a>`);
});

Deno.test("rejects javascript: href", () => {
  const out = sanitizeHtml(`<a href="javascript:alert(1)">click</a>`);
  assertEquals(out, `<a>click</a>`);
});

Deno.test("rejects javascript: href with tab obfuscation", () => {
  const out = sanitizeHtml(`<a href="java\tscript:alert(1)">click</a>`);
  // Tab in attribute should not bypass — scheme check rejects control chars.
  assertNoScript(out, "java<TAB>script:");
  assertEquals(/javascript:/i.test(out), false);
});

Deno.test("rejects vbscript: href", () => {
  const out = sanitizeHtml(`<a href="vbscript:msgbox(1)">x</a>`);
  assertEquals(out, `<a>x</a>`);
});

Deno.test("rejects data: URL in href", () => {
  const out = sanitizeHtml(`<a href="data:text/html,<script>alert(1)</script>">x</a>`);
  assertEquals(out, `<a>x</a>`);
});

Deno.test("rejects data: URL in img src", () => {
  const out = sanitizeHtml(`<img src="data:image/svg+xml,<svg onload=alert(1)/>">`);
  assertEquals(/data:/.test(out), false);
});

Deno.test("allows relative URLs", () => {
  const out = sanitizeHtml(`<a href="/foo/bar">x</a>`);
  assertEquals(out, `<a href="/foo/bar">x</a>`);
});

Deno.test("allows https URLs", () => {
  const out = sanitizeHtml(`<a href="https://example.com">x</a>`);
  assertEquals(out, `<a href="https://example.com">x</a>`);
});

Deno.test("allows mailto and tel", () => {
  assertEquals(
    sanitizeHtml(`<a href="mailto:x@y.com">mail</a>`),
    `<a href="mailto:x@y.com">mail</a>`,
  );
  assertEquals(
    sanitizeHtml(`<a href="tel:+1234">call</a>`),
    `<a href="tel:+1234">call</a>`,
  );
});

Deno.test("strips <iframe>", () => {
  const out = sanitizeHtml(`before<iframe src="https://evil.com"></iframe>after`);
  assertEquals(out, "beforeafter");
});

Deno.test("strips <object>, <embed>, <form>", () => {
  assertEquals(sanitizeHtml(`<object data="x"></object>`), ``);
  assertEquals(sanitizeHtml(`<embed src="x">`), ``);
  assertEquals(sanitizeHtml(`<form action="x"><input></form>`), ``);
});

Deno.test("strips <style>", () => {
  const out = sanitizeHtml(`<p>ok</p><style>body{background:url('javascript:alert(1)')}</style>`);
  assertEquals(out, `<p>ok</p>`);
});

Deno.test("strips style attribute", () => {
  const out = sanitizeHtml(`<p style="color:red; background:url('javascript:alert(1)')">x</p>`);
  assertEquals(out, `<p>x</p>`);
});

Deno.test("preserves formatting tags", () => {
  const input = `<p>Hello <strong>world</strong> and <em>good</em> <a href="/link">morning</a>.</p>`;
  assertEquals(sanitizeHtml(input), input);
});

Deno.test("preserves headings and lists", () => {
  const input = `<h2>Title</h2><ul><li>one</li><li>two</li></ul>`;
  assertEquals(sanitizeHtml(input), input);
});

Deno.test("preserves tables", () => {
  const input = `<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>`;
  assertEquals(sanitizeHtml(input), input);
});

Deno.test("preserves images with safe attrs", () => {
  const input = `<img src="/pic.jpg" alt="pic" width="100" height="50" loading="lazy">`;
  assertEquals(sanitizeHtml(input), input);
});

Deno.test("drops unknown tags but keeps text", () => {
  const out = sanitizeHtml(`<custom>text<fake>more</fake></custom>`);
  assertEquals(out, "textmore");
});

Deno.test("drops unknown attrs", () => {
  const out = sanitizeHtml(`<p data-foo="bar" unknown="x" class="ok">hi</p>`);
  assertEquals(out, `<p class="ok">hi</p>`);
});

Deno.test("escapes text content", () => {
  const out = sanitizeHtml(`<p>5 < 10 & 10 > 5</p>`);
  assertEquals(out, `<p>5 &lt; 10 &amp; 10 &gt; 5</p>`);
});

Deno.test("handles malformed/unterminated tags", () => {
  // No crash on unterminated tag.
  const out = sanitizeHtml(`<p>ok<script`);
  assertEquals(out, `<p>ok</p>`);
});

Deno.test("auto-closes open tags", () => {
  const out = sanitizeHtml(`<p>one<p>two`);
  // Sanitizer doesn't try to fix HTML semantics (nested <p>), it just closes.
  assertStringIncludes(out, "</p>");
});

Deno.test("injects rel=noopener on target=_blank", () => {
  const out = sanitizeHtml(`<a href="https://x.com" target="_blank">x</a>`);
  assertStringIncludes(out, `target="_blank"`);
  assertStringIncludes(out, `rel="noopener noreferrer"`);
});

Deno.test("preserves existing rel when target=_blank and appends noopener", () => {
  const out = sanitizeHtml(`<a href="https://x.com" target="_blank" rel="external">x</a>`);
  assertStringIncludes(out, `rel="external noopener noreferrer"`);
});

Deno.test("rejects bizarre target values", () => {
  const out = sanitizeHtml(`<a href="/x" target="javascript:alert(1)">x</a>`);
  assertEquals(/target=/.test(out), false);
});

Deno.test("strips HTML comments", () => {
  const out = sanitizeHtml(`<p>ok</p><!-- <script>alert(1)</script> --><p>more</p>`);
  assertEquals(out, `<p>ok</p><p>more</p>`);
});

Deno.test("strips DOCTYPE and processing instructions", () => {
  const out = sanitizeHtml(`<!DOCTYPE html><?xml version="1.0"?><p>ok</p>`);
  assertEquals(out, `<p>ok</p>`);
});

Deno.test("handles CDATA by unwrapping as text", () => {
  const out = sanitizeHtml(`<p><![CDATA[1 < 2]]></p>`);
  assertEquals(out, `<p>1 &lt; 2</p>`);
});

Deno.test("handles ill-nested tags by popping stack", () => {
  const out = sanitizeHtml(`<b>bold <i>italic</b> italic</i>`);
  // No crash — output is valid (or at least non-malicious) HTML.
  assertNoScript(out, "ill-nested");
});

Deno.test("empty input returns empty", () => {
  assertEquals(sanitizeHtml(""), "");
});

Deno.test("allowImages=false strips images", () => {
  const out = sanitizeHtml(`<p>hi <img src="/x.png" alt="x"></p>`, { allowImages: false });
  assertEquals(out, `<p>hi </p>`);
});

Deno.test("allowLinks=false strips anchor tags", () => {
  const out = sanitizeHtml(`<p>hi <a href="/x">link</a></p>`, { allowLinks: false });
  assertEquals(out, `<p>hi link</p>`);
});
