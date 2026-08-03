/**
 * Regression test for a gray-matter bug (upstream, not dune's own logic):
 * `matter()` caches its mutable result object keyed by raw content string
 * *before* parsing the YAML frontmatter block, only when called without an
 * options argument. If parsing throws (malformed YAML), the cached object is
 * left half-populated — a second call with the identical string then returns
 * that cached object instead of re-throwing, silently "healing" a file that
 * is still broken. This directly undermined dune's content-index error
 * reporting: a broken file's error would only appear on the first build in a
 * process's lifetime (e.g. `dune dev`'s first index), then vanish on every
 * subsequent rebuild (e.g. a file-watcher-triggered rebuild for an unrelated
 * change) even though the file was never fixed.
 *
 * Both handlers now pass an explicit (empty) options object to `matter()`,
 * which bypasses the cache entirely (see markdown.ts/mdx.ts's
 * extractFrontmatter for the exact mechanism). This test calls
 * extractFrontmatter twice with the same malformed content and asserts both
 * calls throw — the second call is the one that silently didn't before.
 */

import { assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { MarkdownHandler } from "../../src/content/formats/markdown.ts";
import { MdxHandler } from "../../src/content/formats/mdx.ts";

const MALFORMED = "---\ntitle: [oops\n---\n\n# Broken\n";

Deno.test("MarkdownHandler: extractFrontmatter throws consistently on repeated calls with the same malformed content", async () => {
  const handler = new MarkdownHandler();
  await assertRejects(() => handler.extractFrontmatter(MALFORMED, "a.md"));
  // The regression: a second call with identical content used to silently
  // return the corrupted cached object instead of throwing again.
  await assertRejects(() => handler.extractFrontmatter(MALFORMED, "b.md"));
});

Deno.test("MdxHandler: extractFrontmatter throws consistently on repeated calls with the same malformed content", async () => {
  const handler = new MdxHandler();
  await assertRejects(() => handler.extractFrontmatter(MALFORMED, "a.mdx"));
  await assertRejects(() => handler.extractFrontmatter(MALFORMED, "b.mdx"));
});
