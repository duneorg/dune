/**
 * Tests for src/core/engine.ts — createDuneEngine
 *
 * Verifies engine initialization, route resolution, page loading,
 * media serving, and rebuild behaviour using minimal in-memory stubs.
 * The theme loader falls back gracefully when theme.yaml is absent, so
 * all theme-related storage calls just return exists()→false.
 */

import {
  assertEquals,
  assertExists,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { createDuneEngine } from "../../src/core/engine.ts";
import { FormatRegistry } from "../../src/content/formats/registry.ts";
import type { StorageAdapter, StorageEntry, StorageStat } from "../../src/storage/types.ts";
import type { DuneConfig } from "../../src/config/types.ts";
import type { PageFrontmatter } from "../../src/content/types.ts";

// ---------------------------------------------------------------------------
// Stub helpers
// ---------------------------------------------------------------------------

/** A content file descriptor used to build storage stubs */
interface ContentFile {
  /** Filename (e.g. "default.md") */
  name: string;
  /** Full path relative to storage root (e.g. "content/01.home/default.md") */
  path: string;
  /** Raw file text (should include YAML frontmatter) */
  text: string;
  mtime?: number;
  size?: number;
}

/**
 * Build a minimal StorageAdapter for content-only tests.
 *
 * - listRecursive(contentDir) → returns entries for all registered files
 * - exists(path) → true for content files only (false for theme files)
 * - stat(path) → minimal stat for registered files
 * - readText(path) → registered content for registered files
 * - list(dir) → [] (no co-located media by default)
 * - read(path) → rejects (no binary files by default)
 * - all cache / watch methods are no-ops
 */
function makeStorage(files: ContentFile[]): StorageAdapter {
  const fileMap = new Map<string, ContentFile>(files.map((f) => [f.path, f]));

  const entries: StorageEntry[] = files.map((f) => ({
    name: f.name,
    path: f.path,
    isFile: true,
    isDirectory: false,
  }));

  return {
    listRecursive: (_path: string) => Promise.resolve(entries),

    exists: (path: string) => Promise.resolve(fileMap.has(path)),

    stat: (path: string): Promise<StorageStat> => {
      const f = fileMap.get(path);
      if (!f) return Promise.reject(new Error(`stat: not found: ${path}`));
      return Promise.resolve({
        size: f.size ?? 100,
        mtime: f.mtime ?? 1_000,
        isFile: true,
        isDirectory: false,
      });
    },

    readText: (path: string) => {
      const f = fileMap.get(path);
      if (!f) return Promise.reject(new Error(`readText: not found: ${path}`));
      return Promise.resolve(f.text);
    },

    // Binary read — not needed for basic engine tests
    read: (_path: string) => Promise.reject(new Error("read: not implemented")),

    // No co-located media
    list: (_dir: string) => Promise.resolve([]),

    write: () => Promise.reject(new Error("write: not implemented")),
    delete: () => Promise.reject(new Error("delete: not implemented")),
    getJSON: () => Promise.resolve(null),
    setJSON: () => Promise.resolve(),
    deleteJSON: () => Promise.resolve(),
    watch: () => () => {},
  } as unknown as StorageAdapter;
}

/**
 * Extend a base storage with a set of override entries that take precedence.
 * Useful for adding binary files (serveMedia tests) on top of a content storage.
 */
function withBinaryFile(
  base: StorageAdapter,
  path: string,
  data: Uint8Array,
  size: number,
): StorageAdapter {
  return {
    ...base,
    exists: async (p: string) => {
      if (p === path) return true;
      return base.exists(p);
    },
    read: async (p: string) => {
      if (p === path) return data;
      return base.read(p);
    },
    stat: async (p: string) => {
      if (p === path) {
        return { size, mtime: 2_000, isFile: true, isDirectory: false };
      }
      return base.stat(p);
    },
  } as unknown as StorageAdapter;
}

/**
 * Build a FormatRegistry with a simple .md handler.
 *
 * extractFrontmatter reads the `title` from the YAML block so that the
 * content index carries real titles without a full YAML parser.
 * The body is the raw content after the closing `---`.
 */
function makeFormats(
  frontmatterOverrides: Map<string, Partial<PageFrontmatter>> = new Map(),
): FormatRegistry {
  const registry = new FormatRegistry();
  registry.register({
    extensions: [".md"],
    extractFrontmatter: (_raw: string, filePath: string): Promise<PageFrontmatter> => {
      const overrides = frontmatterOverrides.get(filePath) ?? {};
      return Promise.resolve({
        title: overrides.title ?? "Untitled",
        published: overrides.published ?? true,
        visible: overrides.visible ?? true,
        taxonomy: overrides.taxonomy ?? {},
        ...overrides,
      } as PageFrontmatter);
    },
    extractBody: (raw: string, _filePath: string): string | null => {
      // Return the body after the second `---`
      const parts = raw.split(/^---\s*$/m);
      return parts.length >= 3 ? parts.slice(2).join("---").trim() : null;
    },
    renderToHtml: (_page, _ctx) => Promise.resolve("<p>stub html</p>"),
  });
  return registry;
}

// ---------------------------------------------------------------------------
// Stub config
// ---------------------------------------------------------------------------

/**
 * Minimal DuneConfig that satisfies every field the engine accesses.
 * Override fields per test as needed.
 */
function makeConfig(overrides: Partial<DuneConfig> = {}): DuneConfig {
  const base: DuneConfig = {
    site: {
      title: "Test Site",
      description: "",
      url: "http://localhost",
      author: { name: "" },
      metadata: {},
      taxonomies: [],
      routes: {},
      redirects: {},
    },
    system: {
      content: {
        dir: "content",
        markdown: { extra: false, auto_links: false, auto_url_links: false },
      },
      languages: {
        supported: ["en"],
        default: "en",
        include_default_in_url: false,
      },
      debug: false,
      cache: { enabled: false, driver: "memory", lifetime: 0, check: "none" },
      images: { default_quality: 80, cache_dir: "", allowed_sizes: [] },
      typography: { orphan_protection: false },
      timezone: "UTC",
    },
    theme: { name: "default", custom: {} },
    plugins: {},
  };
  return { ...base, ...overrides } as DuneConfig;
}

// ---------------------------------------------------------------------------
// Content helpers
// ---------------------------------------------------------------------------

/** Build a ContentFile for a top-level page slug like "01.home" */
function contentFile(
  slug: string,
  title: string,
  extra: Partial<ContentFile> = {},
): ContentFile {
  return {
    name: "default.md",
    path: `content/${slug}/default.md`,
    text: `---\ntitle: ${title}\n---\n\nBody text for ${title}.`,
    mtime: 1_000,
    size: 100,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test("init(): populates engine.pages after initialisation", async () => {
  const files = [
    contentFile("01.home", "Home"),
    contentFile("02.about", "About"),
  ];

  const fm = new Map([
    ["content/01.home/default.md", { title: "Home" }],
    ["content/02.about/default.md", { title: "About" }],
  ]);

  const engine = await createDuneEngine({
    storage: makeStorage(files),
    config: makeConfig(),
    formats: makeFormats(fm),
  });

  assertEquals(engine.pages.length, 0, "pages should be empty before init()");

  await engine.init();

  assertEquals(engine.pages.length, 2, "engine.pages should have 2 pages after init()");
  assertExists(engine.router, "engine.router should be set after init()");
  assertExists(engine.themes, "engine.themes should be set after init()");
});

Deno.test("init(): taxonomyMap is populated from frontmatter taxonomy", async () => {
  const files = [
    contentFile("01.post", "Post"),
  ];

  const fm = new Map([
    ["content/01.post/default.md", { title: "Post", taxonomy: { tag: ["deno", "testing"] } }],
  ]);

  const engine = await createDuneEngine({
    storage: makeStorage(files),
    config: makeConfig(),
    formats: makeFormats(fm),
  });

  await engine.init();

  assertExists(engine.taxonomyMap.tag, "taxonomyMap should have 'tag' dimension");
  assertExists(engine.taxonomyMap.tag["deno"], "taxonomyMap.tag should have 'deno'");
  assertExists(engine.taxonomyMap.tag["testing"], "taxonomyMap.tag should have 'testing'");
});

Deno.test("resolve(): returns 'not-found' for unknown route", async () => {
  const files = [contentFile("01.home", "Home")];
  const fm = new Map([["content/01.home/default.md", { title: "Home" }]]);

  const engine = await createDuneEngine({
    storage: makeStorage(files),
    config: makeConfig(),
    formats: makeFormats(fm),
  });

  await engine.init();

  const result = await engine.resolve("/nonexistent-page");
  assertEquals(result.type, "not-found");
  assertEquals(result.page, undefined);
});

Deno.test("resolve(): returns 'redirect' for configured redirect", async () => {
  const files = [contentFile("01.home", "Home")];
  const fm = new Map([["content/01.home/default.md", { title: "Home" }]]);

  const config = makeConfig({
    site: {
      title: "Test Site",
      description: "",
      url: "http://localhost",
      author: { name: "" },
      metadata: {},
      taxonomies: [],
      routes: {},
      redirects: { "/old-path": "/new-path" },
    },
  });

  const engine = await createDuneEngine({
    storage: makeStorage(files),
    config,
    formats: makeFormats(fm),
  });

  await engine.init();

  const result = await engine.resolve("/old-path");
  assertEquals(result.type, "redirect");
  assertEquals(result.redirectTo, "/new-path");
});

Deno.test("resolve(): returns 'page' for the home route '/'", async () => {
  const files = [contentFile("01.home", "Home")];
  const fm = new Map([["content/01.home/default.md", { title: "Home" }]]);

  const engine = await createDuneEngine({
    storage: makeStorage(files),
    config: makeConfig(),
    formats: makeFormats(fm),
  });

  await engine.init();

  const result = await engine.resolve("/");

  assertEquals(result.type, "page");
  assertExists(result.page, "result.page should be defined for '/'");
  assertEquals(result.page!.frontmatter.title, "Home");
});

Deno.test("resolve(): returns correct page for a named route", async () => {
  const files = [
    contentFile("01.home", "Home"),
    contentFile("02.about", "About"),
  ];
  const fm = new Map([
    ["content/01.home/default.md", { title: "Home" }],
    ["content/02.about/default.md", { title: "About" }],
  ]);

  const engine = await createDuneEngine({
    storage: makeStorage(files),
    config: makeConfig(),
    formats: makeFormats(fm),
  });

  await engine.init();

  const result = await engine.resolve("/about");
  assertEquals(result.type, "page");
  assertExists(result.page);
  assertEquals(result.page!.frontmatter.title, "About");
});

Deno.test("loadPage(): throws for a sourcePath not in the content index", async () => {
  const files = [contentFile("01.home", "Home")];
  const fm = new Map([["content/01.home/default.md", { title: "Home" }]]);

  const engine = await createDuneEngine({
    storage: makeStorage(files),
    config: makeConfig(),
    formats: makeFormats(fm),
  });

  await engine.init();

  await assertRejects(
    () => engine.loadPage("99.does-not-exist/default.md"),
    Error,
    "not found in content index",
  );
});

Deno.test("serveMedia(): returns null for a missing media file", async () => {
  const files = [contentFile("01.home", "Home")];
  const fm = new Map([["content/01.home/default.md", { title: "Home" }]]);

  const engine = await createDuneEngine({
    storage: makeStorage(files),
    config: makeConfig(),
    formats: makeFormats(fm),
  });

  await engine.init();

  const result = await engine.serveMedia("01.home/cover.jpg");
  assertEquals(result, null);
});

Deno.test("serveMedia(): returns bytes and MIME type for an existing media file", async () => {
  const files = [contentFile("01.home", "Home")];
  const fm = new Map([["content/01.home/default.md", { title: "Home" }]]);

  const imageData = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]); // minimal JPEG header
  const mediaPath = "content/01.home/cover.jpg";

  const storage = withBinaryFile(
    makeStorage(files),
    mediaPath,
    imageData,
    imageData.byteLength,
  );

  const engine = await createDuneEngine({
    storage,
    config: makeConfig(),
    formats: makeFormats(fm),
  });

  await engine.init();

  const result = await engine.serveMedia("01.home/cover.jpg");
  assertExists(result, "serveMedia should return a MediaResponse for an existing file");
  assertEquals(result!.data, imageData);
  assertEquals(result!.contentType, "image/jpeg");
  assertEquals(result!.size, imageData.byteLength);
});

Deno.test("rebuild(): clears page cache and re-indexes content", async () => {
  const files = [contentFile("01.home", "Home")];
  const fm = new Map([["content/01.home/default.md", { title: "Home" }]]);

  const engine = await createDuneEngine({
    storage: makeStorage(files),
    config: makeConfig(),
    formats: makeFormats(fm),
  });

  await engine.init();
  assertEquals(engine.pages.length, 1, "should have 1 page after init");

  // rebuild() should complete without error and maintain the index
  await engine.rebuild();

  assertEquals(engine.pages.length, 1, "engine.pages should still be 1 after rebuild");
  assertEquals(engine.pages[0].title, "Home");
});

Deno.test("rebuild(): concurrent calls serialize safely", async () => {
  const files = [
    contentFile("01.home", "Home"),
    contentFile("02.blog", "Blog"),
  ];
  const fm = new Map([
    ["content/01.home/default.md", { title: "Home" }],
    ["content/02.blog/default.md", { title: "Blog" }],
  ]);

  const engine = await createDuneEngine({
    storage: makeStorage(files),
    config: makeConfig(),
    formats: makeFormats(fm),
  });

  await engine.init();

  // Fire off three concurrent rebuilds — all should resolve cleanly
  await Promise.all([engine.rebuild(), engine.rebuild(), engine.rebuild()]);

  assertEquals(engine.pages.length, 2, "index should remain intact after concurrent rebuilds");
});

Deno.test("engine.site: is a shortcut to config.site", async () => {
  const config = makeConfig();
  const files = [contentFile("01.home", "Home")];
  const fm = new Map([["content/01.home/default.md", { title: "Home" }]]);

  const engine = await createDuneEngine({
    storage: makeStorage(files),
    config,
    formats: makeFormats(fm),
  });

  await engine.init();

  assertEquals(engine.site, config.site);
  assertEquals(engine.config, config);
});

Deno.test("resolve(): page cache — same page object returned on second access", async () => {
  const files = [contentFile("01.home", "Home")];
  const fm = new Map([["content/01.home/default.md", { title: "Home" }]]);

  const engine = await createDuneEngine({
    storage: makeStorage(files),
    config: makeConfig(),
    formats: makeFormats(fm),
  });

  await engine.init();

  const first = await engine.resolve("/");
  const second = await engine.resolve("/");

  // Both should succeed and the page objects should be the same (cached reference)
  assertEquals(first.type, "page");
  assertEquals(second.type, "page");
  assertEquals(first.page === second.page, true, "cached page should be the identical object");
});
