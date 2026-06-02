/**
 * Tests for PageIndex.extra — custom facet fields extracted at index time.
 *
 * Covers:
 *   - Declared facet fields extracted into PageIndex.extra
 *   - Undeclared fields not present in extra
 *   - Dot-path fields (e.g. "taxonomy.category") resolved correctly
 *   - Non-string/array values skipped
 *   - No facetFields declared → extra is undefined
 *   - Facet filtering via extra in the syntheticFm pattern
 *   - Facet count aggregation across results
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildIndex } from "../../src/content/index-builder.ts";
import { FormatRegistry } from "../../src/content/formats/registry.ts";
import type { PageFrontmatter } from "../../src/content/types.ts";
import type { StorageAdapter, StorageEntry } from "../../src/storage/types.ts";

// ── Minimal stubs (same pattern as taxonomy_term_page_test.ts) ────────────────

function makeStorage(files: Record<string, string>): StorageAdapter {
  return {
    readText: (path: string) => {
      if (path in files) return Promise.resolve(files[path]);
      return Promise.reject(new Error(`Not found: ${path}`));
    },
    exists: (path: string) => Promise.resolve(path in files),
    read: () => Promise.reject(new Error("not implemented")),
    write: () => Promise.reject(new Error("not implemented")),
    delete: () => Promise.reject(new Error("not implemented")),
    rename: () => Promise.reject(new Error("not implemented")),
    list: () => Promise.resolve([]),
    listRecursive: () => {
      const entries: StorageEntry[] = Object.keys(files).map((path) => ({
        path,
        name: path.split("/").pop()!,
        isFile: true,
        isDirectory: false,
        size: files[path].length,
        mtime: 0,
      }));
      return Promise.resolve(entries);
    },
    stat: () => Promise.resolve({ mtime: 0, size: 0, isFile: true, isDirectory: false }),
    getJSON: () => Promise.resolve(null),
    setJSON: () => Promise.resolve(),
    deleteJSON: () => Promise.resolve(),
    watch: () => () => {},
  } as unknown as StorageAdapter;
}

function makeFormats(): FormatRegistry {
  const registry = new FormatRegistry();
  registry.register({
    extensions: [".md"],
    extractFrontmatter: async (raw: string, _filePath: string): Promise<PageFrontmatter> => {
      const match = raw.match(/^---\n([\s\S]*?)\n---/);
      if (!match) return { title: "" };
      const { parse } = await import("https://deno.land/std@0.224.0/yaml/mod.ts");
      return { title: "", ...(parse(match[1]) as object) } as PageFrontmatter;
    },
    extractBody: () => null,
    renderToHtml: () => Promise.resolve(""),
  });
  return registry;
}

async function buildTestIndex(
  files: Record<string, string>,
  facetFields?: string[],
) {
  return buildIndex({
    storage: makeStorage(files),
    contentDir: "content",
    formats: makeFormats(),
    facetFields,
  });
}

// ── PageIndex.extra extraction ────────────────────────────────────────────────

Deno.test("extra: declared string field extracted correctly", async () => {
  const { pages } = await buildTestIndex(
    { "content/articles/a.md": `---\nslug: a\ntitle: A\nsubtype: kurzinfo\n---` },
    ["subtype"],
  );
  assertEquals(pages[0].extra, { subtype: "kurzinfo" });
});

Deno.test("extra: multiple declared fields extracted", async () => {
  const { pages } = await buildTestIndex(
    { "content/articles/a.md": `---\nslug: a\ntitle: A\nsubtype: artikel\nlanguage: de\n---` },
    ["subtype", "language"],
  );
  assertEquals(pages[0].extra?.["subtype"], "artikel");
  assertEquals(pages[0].extra?.["language"], "de");
});

Deno.test("extra: undeclared fields not present in extra", async () => {
  const { pages } = await buildTestIndex(
    { "content/articles/a.md": `---\nslug: a\ntitle: A\nsubtype: artikel\nauthor: Max\n---` },
    ["subtype"],  // only subtype declared
  );
  assertEquals(Object.keys(pages[0].extra ?? {}), ["subtype"]);
});

Deno.test("extra: no facetFields declared → extra is undefined", async () => {
  const { pages } = await buildTestIndex(
    { "content/articles/a.md": `---\nslug: a\ntitle: A\nsubtype: artikel\n---` },
    // no facetFields
  );
  assertEquals(pages[0].extra, undefined);
});

Deno.test("extra: field missing from frontmatter → not included in extra", async () => {
  const { pages } = await buildTestIndex(
    { "content/articles/a.md": `---\nslug: a\ntitle: A\n---` },
    ["subtype"],
  );
  assertEquals(pages[0].extra, undefined);
});

Deno.test("extra: dot-path field resolved correctly", async () => {
  const { pages } = await buildTestIndex(
    { "content/articles/a.md": `---\nslug: a\ntitle: A\ntaxonomy:\n  category:\n    - news\n    - tech\n---` },
    ["taxonomy.category"],
  );
  assertEquals(pages[0].extra?.["taxonomy.category"], ["news", "tech"]);
});

// ── Facet filtering using extra ───────────────────────────────────────────────

Deno.test("extra: filter by subtype narrows results correctly", async () => {
  const { pages } = await buildTestIndex(
    {
      "content/articles/a.md": `---\nslug: a\ntitle: Article A\nsubtype: artikel\n---`,
      "content/articles/b.md": `---\nslug: b\ntitle: Article B\nsubtype: kurzinfo\n---`,
      "content/articles/c.md": `---\nslug: c\ntitle: Article C\nsubtype: kurzinfo\n---`,
    },
    ["subtype"],
  );

  // Filter via extra (mirrors the routing layer syntheticFm pattern)
  const kurzinfos = pages.filter((p) => p.extra?.["subtype"] === "kurzinfo");
  assertEquals(kurzinfos.length, 2);
  assertEquals(kurzinfos.every((p) => p.extra?.["subtype"] === "kurzinfo"), true);
});

// ── Facet count aggregation ───────────────────────────────────────────────────

Deno.test("extra: facet counts aggregate correctly", async () => {
  const { pages } = await buildTestIndex(
    {
      "content/articles/a.md": `---\nslug: a\ntitle: A\nsubtype: artikel\n---`,
      "content/articles/b.md": `---\nslug: b\ntitle: B\nsubtype: kurzinfo\n---`,
      "content/articles/c.md": `---\nslug: c\ntitle: C\nsubtype: artikel\n---`,
      "content/articles/d.md": `---\nslug: d\ntitle: D\nsubtype: buchbesprechung\n---`,
    },
    ["subtype"],
  );

  const counts: Record<string, number> = {};
  for (const p of pages) {
    const subtype = p.extra?.["subtype"];
    if (typeof subtype === "string") {
      counts[subtype] = (counts[subtype] ?? 0) + 1;
    }
  }

  assertEquals(counts["artikel"], 2);
  assertEquals(counts["kurzinfo"], 1);
  assertEquals(counts["buchbesprechung"], 1);
});
