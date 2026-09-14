/**
 * Tests for email/templates.ts's stripHtml() — the HTML-to-plain-text
 * conversion used to build EmailTemplate.text.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { stripHtml } from "../../src/email/templates.ts";

Deno.test("stripHtml: does not double-unescape an already-encoded entity", () => {
  // "&amp;lt;" is the correctly-encoded form of the literal text "&lt;".
  // Decoding &amp; before &lt; would turn it into a live "<" — the
  // js/double-escaping bug. Decoding &amp; last keeps it inert.
  const out = stripHtml("Entity: &amp;lt;");
  assertEquals(out, "Entity: &lt;");
});

Deno.test("stripHtml: still decodes a genuine entity to its character", () => {
  const out = stripHtml("Tom &amp; Jerry");
  assertEquals(out, "Tom & Jerry");
});

Deno.test("stripHtml: strips tags and converts block breaks to newlines", () => {
  const out = stripHtml("<p>one</p><p>two<br>three</p>");
  assertEquals(out, "one\n\ntwo\nthree");
});

Deno.test("stripHtml: nested/malformed markup can't leave a live tag behind", () => {
  const out = stripHtml("<scr<script>ipt>alert(1)</script>");
  assertEquals(out.toLowerCase().includes("<script"), false);
});
