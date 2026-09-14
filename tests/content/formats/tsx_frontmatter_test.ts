/**
 * Tests for TsxHandler's regex-based `export const frontmatter = { ... }`
 * fallback extraction — specifically the JS-object-literal-to-JSON
 * conversion in `jsObjectToJson()`.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { TsxHandler } from "../../../src/content/formats/tsx.ts";

Deno.test("TsxHandler: frontmatter string containing a raw backslash round-trips intact", async () => {
  // A single backslash in a single-quoted frontmatter string value used to
  // pass straight through into the JSON-ized output unescaped
  // (js/incomplete-sanitization: only `"` was escaped, not `\`). Some
  // sequences (e.g. \b, \t) are valid JSON escapes and would silently
  // corrupt the value (backslash+letter becomes a control character);
  // others (e.g. \s here) aren't valid JSON escapes at all and would fail
  // JSON.parse entirely, silently discarding the real frontmatter in favor
  // of defaults. Escaping "\" before "\"" fixes both.
  const handler = new TsxHandler();
  const raw = `export const frontmatter = {
  title: 'Back\\slash test',
  published: true
};

export default function Page() { return null; }
`;

  const fm = await handler.extractFrontmatter(raw, "/nonexistent/page.tsx");

  assertEquals(fm.title, "Back\\slash test");
  assertEquals(fm.published, true);
});

Deno.test("TsxHandler: frontmatter string with a doubled trailing backslash round-trips intact", async () => {
  const handler = new TsxHandler();
  // Two literal backslash characters right before the closing quote —
  // regression coverage for the boundary the fix targets.
  const raw = `export const frontmatter = {
  title: 'trailing backslash \\\\',
  published: false
};

export default function Page() { return null; }
`;

  const fm = await handler.extractFrontmatter(raw, "/nonexistent/page.tsx");

  assertEquals(fm.title, "trailing backslash \\\\");
  assertEquals(fm.published, false);
});
