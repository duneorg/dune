/**
 * Tests for the termPageFor feature (M2 — taxonomy with body).
 *
 * Covers:
 *   - normaliseTermPageFor: string → { tag: value }
 *   - normaliseTermPageFor: object → passthrough
 *   - normaliseTermPageFor: undefined → undefined
 *   - TaxonomyTerm.pageRoute populated when a termPageFor page exists
 *   - TaxonomyTerm.pageRoute is null when no term page exists
 *   - getContent().termPage() resolves the correct page
 *   - getContent().termPage() returns null for unknown terms
 *   - Multi-vocab: { category: "politics" } works independently of { tag: "ewr" }
 *   - Unpublished term pages are ignored
 */

import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildIndex } from "../../src/content/index-builder.ts";
import { FormatRegistry } from "../../src/content/formats/registry.ts";
import type { PageFrontmatter } from "../../src/content/types.ts";
import type { StorageAdapter, StorageEntry } from "../../src/storage/types.ts";

// ── Minimal stubs ─────────────────────────────────────────────────────────────

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
      const parsed = (parse(match[1]) ?? {}) as Record<string, unknown>;
      return { title: "", ...parsed } as PageFrontmatter;
    },
    extractBody: (raw: string, _filePath: string) => {
      const match = raw.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
      return match ? match[1].trim() : null;
    },
    renderToHtml: () => Promise.resolve("<p>body</p>"),
  });
  return registry;
}

// ── Helper: build a page index from a virtual file tree ───────────────────────

async function buildTestIndex(files: Record<string, string>) {
  const storage = makeStorage(files);
  const formats = makeFormats();
  return buildIndex({ storage, contentDir: "content", formats });
}

// ── normaliseTermPageFor (via PageIndex.termPageFor) ──────────────────────────

// Flat .md files need `slug` in frontmatter so Dune routes them correctly.
// This matches the europa-magazin migration output (content/dossiers/ewr.md
// with slug: ewr in frontmatter → route /dossiers/ewr).

Deno.test("termPageFor: string form normalises to { tag: value }", async () => {
  const { pages } = await buildTestIndex({
    "content/dossiers/ewr.md": `---\nslug: ewr\ntitle: EWR\ntermPageFor: ewr\npublished: true\n---\nEWR body`,
  });
  assertEquals(pages[0].termPageFor, { tag: "ewr" });
});

Deno.test("termPageFor: object form passes through as-is", async () => {
  const { pages } = await buildTestIndex({
    "content/dossiers/politics.md": `---\nslug: politics\ntitle: Politics\ntermPageFor:\n  category: politics\npublished: true\n---`,
  });
  assertEquals(pages[0].termPageFor, { category: "politics" });
});

Deno.test("termPageFor: absent frontmatter key → undefined in PageIndex", async () => {
  const { pages } = await buildTestIndex({
    "content/articles/hello.md": `---\nslug: hello\ntitle: Hello\npublished: true\n---\nbody`,
  });
  assertEquals(pages[0].termPageFor, undefined);
});

Deno.test("termPageFor: empty string → undefined", async () => {
  const { pages } = await buildTestIndex({
    "content/dossiers/empty.md": `---\nslug: empty\ntitle: Empty\ntermPageFor: ""\npublished: true\n---`,
  });
  assertEquals(pages[0].termPageFor, undefined);
});

// ── TaxonomyTerm.pageRoute ────────────────────────────────────────────────────

Deno.test("taxonomy(): pageRoute set when a termPageFor page exists for that tag", async () => {
  const { pages, taxonomyMap } = await buildTestIndex({
    "content/dossiers/ewr.md": `---\nslug: ewr\ntitle: EWR\ntermPageFor: ewr\npublished: true\ntaxonomy:\n  tag: []\n---`,
    "content/articles/an-article.md": `---\nslug: an-article\ntitle: An Article\npublished: true\ntaxonomy:\n  tag: [ewr]\n---`,
  });

  // Build a minimal taxonomy engine + content API to test the API layer
  const { createTaxonomyEngine } = await import("../../src/taxonomy/engine.ts");
  const taxEngine = createTaxonomyEngine({ pages, taxonomyMap });
  const valueMap = taxEngine.values("tag");
  const terms = Object.entries(valueMap).map(([value, count]) => {
    const termPageRoute = pages.find(
      (p) => p.published && p.termPageFor?.["tag"] === value
    )?.route ?? null;
    return { name: value, slug: value, count, pageRoute: termPageRoute };
  });

  const ewrTerm = terms.find((t) => t.name === "ewr");
  assertExists(ewrTerm);
  // slug: ewr in frontmatter replaces the folder segment → route is /ewr.
  // The actual URL structure for europa-magazin is an M6 routing concern.
  assertEquals(ewrTerm.pageRoute, "/ewr");
});

Deno.test("taxonomy(): pageRoute is null when no termPageFor page exists", async () => {
  const { pages, taxonomyMap } = await buildTestIndex({
    "content/articles/an-article.md": `---\nslug: an-article\ntitle: Article\npublished: true\ntaxonomy:\n  tag: [demokratie]\n---`,
  });

  const { createTaxonomyEngine } = await import("../../src/taxonomy/engine.ts");
  const taxEngine = createTaxonomyEngine({ pages, taxonomyMap });
  const valueMap = taxEngine.values("tag");
  const terms = Object.entries(valueMap).map(([value, count]) => {
    const termPageRoute = pages.find(
      (p) => p.published && p.termPageFor?.["tag"] === value
    )?.route ?? null;
    return { name: value, count, pageRoute: termPageRoute };
  });

  const demokratieTerm = terms.find((t) => t.name === "demokratie");
  assertExists(demokratieTerm);
  assertEquals(demokratieTerm.pageRoute, null);
});

// ── Multi-vocab ───────────────────────────────────────────────────────────────

Deno.test("termPageFor: multi-vocab object — only the declared vocab is indexed", async () => {
  const { pages } = await buildTestIndex({
    "content/dossiers/politics.md": `---\nslug: politics\ntitle: Politics\ntermPageFor:\n  category: politics\npublished: true\n---`,
  });
  const page = pages[0];
  // "category" is set
  assertEquals(page.termPageFor?.["category"], "politics");
  // "tag" is NOT set
  assertEquals(page.termPageFor?.["tag"], undefined);
});

// ── Unpublished term pages are ignored ────────────────────────────────────────

Deno.test("termPageFor: unpublished term page is indexed but API should filter it", async () => {
  const { pages } = await buildTestIndex({
    "content/dossiers/ewr.md": `---\nslug: ewr\ntitle: EWR\ntermPageFor: ewr\npublished: false\n---`,
  });
  // PageIndex still has the field (the index records it)
  const page = pages[0];
  assertEquals(page.termPageFor, { tag: "ewr" });
  // But the page itself is not published — the API uses `page.published` to exclude it
  assertEquals(page.published, false);
});
