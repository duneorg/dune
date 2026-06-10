/**
 * Tests for ETag generation, including the transform-pipeline fingerprint
 * added in the v0.17 audit (F3).
 */

import { assertEquals, assertNotEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { computeEtag, etagMatches } from "../../src/cache/etag.ts";
import type { PageIndex } from "../../src/content/types.ts";

function makePage(overrides: Partial<PageIndex> = {}): PageIndex {
  return {
    sourcePath: "content/about.md",
    route: "/about",
    language: "en",
    format: "markdown",
    template: "default",
    title: "About",
    navTitle: "About",
    date: null,
    published: true,
    status: "published",
    visible: true,
    mtime: 1000,
    ...overrides,
  } as PageIndex;
}

Deno.test("computeEtag: stable for identical input", async () => {
  const a = await computeEtag(makePage());
  const b = await computeEtag(makePage());
  assertEquals(a, b);
  assertMatch(a, /^"[0-9a-f]{16}"$/);
});

Deno.test("computeEtag: changes when content metadata changes", async () => {
  const base = await computeEtag(makePage());
  const touched = await computeEtag(makePage({ mtime: 2000 }));
  assertNotEquals(base, touched);
});

Deno.test("computeEtag: changes when the pipeline fingerprint changes (F3)", async () => {
  const page = makePage();
  const without = await computeEtag(page);
  const v1 = await computeEtag(page, "inline-edit@1.0.0");
  const v2 = await computeEtag(page, "inline-edit@1.1.0");
  const removed = await computeEtag(page, "");

  assertNotEquals(without, v1);
  assertNotEquals(v1, v2);
  assertEquals(removed, without); // empty fingerprint === no fingerprint
});

Deno.test("computeEtag: same fingerprint is stable", async () => {
  const page = makePage();
  const a = await computeEtag(page, "a@1.0.0,b@2.0.0");
  const b = await computeEtag(page, "a@1.0.0,b@2.0.0");
  assertEquals(a, b);
});

Deno.test("etagMatches: wildcard and list handling", () => {
  assertEquals(etagMatches(null, '"abc"'), false);
  assertEquals(etagMatches("*", '"abc"'), true);
  assertEquals(etagMatches('"abc"', '"abc"'), true);
  assertEquals(etagMatches('"x", "abc"', '"abc"'), true);
  assertEquals(etagMatches('"x", "y"', '"abc"'), false);
});
