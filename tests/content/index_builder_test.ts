import { assertEquals, assertExists, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildIndex, updateIndex, detectHomeSlug } from "../../src/content/index-builder.ts";
import { FormatRegistry } from "../../src/content/formats/registry.ts";
import type { StorageAdapter, StorageEntry, StorageStat } from "../../src/storage/types.ts";
import type { PageFrontmatter } from "../../src/content/types.ts";

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

/** A file descriptor used to build the storage stub */
interface FakeFile {
  name: string;
  path: string;
  frontmatter: Partial<PageFrontmatter>;
  mtime?: number;
}

/** Build a minimal StorageAdapter stub from a flat list of file descriptors */
function makeStorage(files: FakeFile[]): StorageAdapter {
  const entries: StorageEntry[] = files.map((f) => ({
    name: f.name,
    path: f.path,
    isFile: true,
    isDirectory: false,
  }));

  const statMap = new Map<string, StorageStat>(
    files.map((f) => [
      f.path,
      { size: 100, mtime: f.mtime ?? 1000, isFile: true, isDirectory: false },
    ]),
  );

  const contentMap = new Map<string, string>(
    files.map((f) => [f.path, `---\ntitle: "${f.frontmatter.title ?? ""}"\n---\n`]),
  );

  return {
    listRecursive: (_path: string) => Promise.resolve(entries),
    stat: (path: string) => {
      const s = statMap.get(path);
      if (!s) return Promise.reject(new Error(`stat: not found: ${path}`));
      return Promise.resolve(s);
    },
    readText: (path: string) => {
      const c = contentMap.get(path);
      if (c === undefined) return Promise.reject(new Error(`readText: not found: ${path}`));
      return Promise.resolve(c);
    },
    // Unused methods
    exists: () => Promise.resolve(false),
    readBytes: () => Promise.reject(new Error("not implemented")),
    write: () => Promise.reject(new Error("not implemented")),
    delete: () => Promise.reject(new Error("not implemented")),
    list: () => Promise.resolve([]),
    move: () => Promise.reject(new Error("not implemented")),
    copy: () => Promise.reject(new Error("not implemented")),
  } as unknown as StorageAdapter;
}

/** Storage stub that always throws listRecursive */
function makeFailingStorage(): StorageAdapter {
  return {
    listRecursive: () => Promise.reject(new Error("disk failure")),
  } as unknown as StorageAdapter;
}

/** A format registry with a simple Markdown handler */
function makeFormats(frontmatterMap: Map<string, Partial<PageFrontmatter>> = new Map()): FormatRegistry {
  const registry = new FormatRegistry();
  registry.register({
    extensions: [".md"],
    extractFrontmatter: (_raw: string, filePath: string): Promise<PageFrontmatter> => {
      const fm = frontmatterMap.get(filePath) ?? {};
      return Promise.resolve({
        title: fm.title ?? "Untitled",
        published: fm.published ?? true,
        visible: fm.visible ?? true,
        taxonomy: fm.taxonomy ?? {},
        status: fm.status,
        nav_title: fm.nav_title,
        template: fm.template,
        slug: fm.slug,
        ...fm,
      } as PageFrontmatter);
    },
    extractBody: () => null,
    renderToHtml: () => Promise.resolve(""),
  });
  return registry;
}

/** Shorthand: build a FakeFile at the standard path for a slug */
function fakeFile(slug: string, overrides: Partial<PageFrontmatter> = {}, mtime = 1000): FakeFile {
  return {
    name: "default.md",
    path: `content/${slug}/default.md`,
    frontmatter: { title: slug.replace(/^\d+\./, ""), ...overrides },
    mtime,
  };
}

// ---------------------------------------------------------------------------
// Tests — buildIndex basics
// ---------------------------------------------------------------------------

Deno.test("buildIndex: empty content directory produces empty result", async () => {
  const storage: StorageAdapter = {
    listRecursive: () => Promise.resolve([]),
    stat: () => Promise.reject(new Error("n/a")),
    readText: () => Promise.reject(new Error("n/a")),
  } as unknown as StorageAdapter;
  const result = await buildIndex({
    storage,
    contentDir: "content",
    formats: makeFormats(),
  });
  assertEquals(result.pages.length, 0);
  assertEquals(result.indexed, 0);
  assertEquals(result.errors.length, 0);
});

Deno.test("buildIndex: single page indexed correctly", async () => {
  const file = fakeFile("01.home");
  const fm = new Map([["content/01.home/default.md", { title: "Home Page" }]]);
  const result = await buildIndex({
    storage: makeStorage([file]),
    contentDir: "content",
    formats: makeFormats(fm),
  });
  assertEquals(result.pages.length, 1);
  assertEquals(result.indexed, 1);
  assertEquals(result.pages[0].title, "Home Page");
  assertEquals(result.pages[0].route, "/home");
  assertEquals(result.pages[0].depth, 0);
});

Deno.test("buildIndex: multiple pages are all indexed", async () => {
  const files = [
    fakeFile("01.home"),
    fakeFile("02.about"),
    fakeFile("03.blog"),
  ];
  const result = await buildIndex({
    storage: makeStorage(files),
    contentDir: "content",
    formats: makeFormats(),
  });
  assertEquals(result.pages.length, 3);
  assertEquals(result.indexed, 3);
});

Deno.test("buildIndex: pages sorted by route", async () => {
  const files = [
    fakeFile("03.zzz"),
    fakeFile("01.aaa"),
    fakeFile("02.mmm"),
  ];
  const result = await buildIndex({
    storage: makeStorage(files),
    contentDir: "content",
    formats: makeFormats(),
  });
  // Routes should be in alphabetical order after sort
  const routes = result.pages.map((p) => p.route);
  const sorted = [...routes].sort();
  assertEquals(routes, sorted);
});

Deno.test("buildIndex: storage listRecursive failure throws ContentError", async () => {
  await assertRejects(
    () =>
      buildIndex({
        storage: makeFailingStorage(),
        contentDir: "content",
        formats: makeFormats(),
      }),
    Error,
    "Failed to scan content directory",
  );
});

// ---------------------------------------------------------------------------
// Tests — file filtering
// ---------------------------------------------------------------------------

Deno.test("buildIndex: media files are skipped (png, jpg, etc)", async () => {
  const storage: StorageAdapter = {
    listRecursive: () =>
      Promise.resolve([
        { name: "default.md", path: "content/01.home/default.md", isFile: true, isDirectory: false },
        { name: "photo.png", path: "content/01.home/photo.png", isFile: true, isDirectory: false },
        { name: "hero.jpg", path: "content/01.home/hero.jpg", isFile: true, isDirectory: false },
      ]),
    stat: () => Promise.resolve({ size: 100, mtime: 1000, isFile: true, isDirectory: false }),
    readText: () => Promise.resolve("---\ntitle: Home\n---\n"),
  } as unknown as StorageAdapter;

  const result = await buildIndex({ storage, contentDir: "content", formats: makeFormats() });
  assertEquals(result.pages.length, 1);
  assertEquals(result.scanned, 3); // all three were scanned
});

Deno.test("buildIndex: files in _drafts folders are skipped", async () => {
  const storage: StorageAdapter = {
    listRecursive: () =>
      Promise.resolve([
        { name: "default.md", path: "content/01.home/default.md", isFile: true, isDirectory: false },
        { name: "draft.md", path: "content/_drafts/draft.md", isFile: true, isDirectory: false },
      ]),
    stat: () => Promise.resolve({ size: 100, mtime: 1000, isFile: true, isDirectory: false }),
    readText: () => Promise.resolve("---\ntitle: X\n---\n"),
  } as unknown as StorageAdapter;

  const result = await buildIndex({ storage, contentDir: "content", formats: makeFormats() });
  assertEquals(result.pages.length, 1);
  assertEquals(result.pages[0].route, "/home");
});

Deno.test("buildIndex: valid content extension with no handler adds error and skips page", async () => {
  // .mdx passes isContentFile() but the format registry only has .md registered
  const storage: StorageAdapter = {
    listRecursive: () =>
      Promise.resolve([
        { name: "default.mdx", path: "content/01.test/default.mdx", isFile: true, isDirectory: false },
      ]),
    stat: () => Promise.resolve({ size: 100, mtime: 1000, isFile: true, isDirectory: false }),
    readText: () => Promise.resolve(""),
  } as unknown as StorageAdapter;

  // Format registry only has .md registered — .mdx has no handler → error
  const result = await buildIndex({ storage, contentDir: "content", formats: makeFormats() });
  assertEquals(result.pages.length, 0);
  assertEquals(result.errors.length, 1);
  assertEquals(result.errors[0].message.includes("No format handler"), true);
});

// ---------------------------------------------------------------------------
// Tests — frontmatter fields
// ---------------------------------------------------------------------------

Deno.test("buildIndex: published=false is preserved on PageIndex", async () => {
  const file = fakeFile("01.hidden", { published: false });
  const fm = new Map([["content/01.hidden/default.md", { title: "Hidden", published: false }]]);
  const result = await buildIndex({ storage: makeStorage([file]), contentDir: "content", formats: makeFormats(fm) });
  assertEquals(result.pages[0].published, false);
});

Deno.test("buildIndex: nav_title falls back to title when absent", async () => {
  const file = fakeFile("01.home", { title: "Home Page" });
  const fm = new Map([["content/01.home/default.md", { title: "Home Page" }]]);
  const result = await buildIndex({ storage: makeStorage([file]), contentDir: "content", formats: makeFormats(fm) });
  assertEquals(result.pages[0].navTitle, "Home Page");
});

Deno.test("buildIndex: nav_title overrides title when present", async () => {
  const file = fakeFile("01.home", { title: "Home Page", nav_title: "Home" });
  const fm = new Map([["content/01.home/default.md", { title: "Home Page", nav_title: "Home" }]]);
  const result = await buildIndex({ storage: makeStorage([file]), contentDir: "content", formats: makeFormats(fm) });
  assertEquals(result.pages[0].navTitle, "Home");
});

Deno.test("buildIndex: taxonomy is indexed in taxonomyMap", async () => {
  const file = fakeFile("01.post", { title: "Post", taxonomy: { tag: ["deno", "typescript"] } });
  const fm = new Map([
    ["content/01.post/default.md", { title: "Post", taxonomy: { tag: ["deno", "typescript"] } }],
  ]);
  const result = await buildIndex({ storage: makeStorage([file]), contentDir: "content", formats: makeFormats(fm) });
  assertExists(result.taxonomyMap.tag);
  assertExists(result.taxonomyMap.tag["deno"]);
  assertEquals(result.taxonomyMap.tag["deno"].includes("01.post/default.md"), true);
  assertEquals(result.taxonomyMap.tag["typescript"].includes("01.post/default.md"), true);
});

Deno.test("buildIndex: status field inferred from published when absent", async () => {
  const pubFile = fakeFile("01.pub", { title: "Pub", published: true });
  const draftFile = fakeFile("02.draft", { title: "Draft", published: false });
  const fm = new Map([
    ["content/01.pub/default.md", { title: "Pub", published: true }],
    ["content/02.draft/default.md", { title: "Draft", published: false }],
  ]);
  const result = await buildIndex({
    storage: makeStorage([pubFile, draftFile]),
    contentDir: "content",
    formats: makeFormats(fm),
  });
  const pub = result.pages.find((p) => p.route === "/pub")!;
  const draft = result.pages.find((p) => p.route === "/draft")!;
  assertEquals(pub.status, "published");
  assertEquals(draft.status, "draft");
});

// ---------------------------------------------------------------------------
// Tests — depth and hierarchy
// ---------------------------------------------------------------------------

Deno.test("buildIndex: top-level page has depth 0", async () => {
  const file = fakeFile("01.home");
  const result = await buildIndex({ storage: makeStorage([file]), contentDir: "content", formats: makeFormats() });
  assertEquals(result.pages[0].depth, 0);
});

Deno.test("buildIndex: nested page has correct depth", async () => {
  const storage: StorageAdapter = {
    listRecursive: () =>
      Promise.resolve([
        { name: "default.md", path: "content/01.blog/01.post/default.md", isFile: true, isDirectory: false },
      ]),
    stat: () => Promise.resolve({ size: 100, mtime: 1000, isFile: true, isDirectory: false }),
    readText: () => Promise.resolve("---\ntitle: Post\n---\n"),
  } as unknown as StorageAdapter;
  const result = await buildIndex({ storage, contentDir: "content", formats: makeFormats() });
  assertEquals(result.pages[0].depth, 1);
  // getParentPath returns the parent folder path (not the index file)
  assertEquals(result.pages[0].parentPath, "01.blog");
});

// ---------------------------------------------------------------------------
// Tests — homeSlug detection
// ---------------------------------------------------------------------------

Deno.test("buildIndex: homeSlug uses siteHome config when provided", async () => {
  const file = fakeFile("01.home");
  const result = await buildIndex({
    storage: makeStorage([file]),
    contentDir: "content",
    formats: makeFormats(),
    siteHome: "start",
  });
  assertEquals(result.homeSlug, "start");
});

Deno.test("buildIndex: homeSlug auto-detects first ordered top-level page", async () => {
  const files = [fakeFile("01.home"), fakeFile("02.about")];
  const result = await buildIndex({ storage: makeStorage(files), contentDir: "content", formats: makeFormats() });
  assertEquals(result.homeSlug, "home");
});

// ---------------------------------------------------------------------------
// Tests — detectHomeSlug (exported pure function)
// ---------------------------------------------------------------------------

Deno.test("detectHomeSlug: falls back to 'home' when no ordered pages", () => {
  assertEquals(detectHomeSlug([]), "home");
});

Deno.test("detectHomeSlug: returns slug of first ordered top-level page", () => {
  const pages = [
    { sourcePath: "02.about/default.md", depth: 0, order: 2, route: "/about" },
    { sourcePath: "01.start/default.md", depth: 0, order: 1, route: "/start" },
    { sourcePath: "03.blog/default.md", depth: 0, order: 3, route: "/blog" },
  ] as Parameters<typeof detectHomeSlug>[0];
  assertEquals(detectHomeSlug(pages), "start");
});

Deno.test("detectHomeSlug: ignores nested (non-zero depth) pages", () => {
  const pages = [
    { sourcePath: "01.blog/01.post/default.md", depth: 1, order: 1, route: "/blog/post" },
  ] as Parameters<typeof detectHomeSlug>[0];
  // Depth > 0 ignored → falls back
  assertEquals(detectHomeSlug(pages), "home");
});

// ---------------------------------------------------------------------------
// Tests — updateIndex
// ---------------------------------------------------------------------------

Deno.test("updateIndex: unchanged file (same mtime) reuses existing entry", async () => {
  const file = fakeFile("01.home", { title: "Home" }, 1000);
  const initialFm = new Map([["content/01.home/default.md", { title: "Home" }]]);
  const initial = await buildIndex({
    storage: makeStorage([file]),
    contentDir: "content",
    formats: makeFormats(initialFm),
  });

  // Update with same mtime — should reuse existing
  const callCount = { readText: 0 };
  const storage: StorageAdapter = {
    listRecursive: () =>
      Promise.resolve([{ name: "default.md", path: "content/01.home/default.md", isFile: true, isDirectory: false }]),
    stat: () => Promise.resolve({ size: 100, mtime: 1000, isFile: true, isDirectory: false }),
    readText: () => {
      callCount.readText++;
      return Promise.resolve("---\ntitle: Home\n---\n");
    },
  } as unknown as StorageAdapter;

  const result = await updateIndex(initial.pages, initial.taxonomyMap, {
    storage,
    contentDir: "content",
    formats: makeFormats(initialFm),
  });

  assertEquals(result.pages.length, 1);
  assertEquals(result.pages[0].title, "Home");
  // readText should not have been called (mtime matched → reuse)
  assertEquals(callCount.readText, 0);
});

Deno.test("updateIndex: changed file (different mtime) gets reindexed", async () => {
  const file = fakeFile("01.home", { title: "Old Title" }, 1000);
  const initialFm = new Map([["content/01.home/default.md", { title: "Old Title" }]]);
  const initial = await buildIndex({
    storage: makeStorage([file]),
    contentDir: "content",
    formats: makeFormats(initialFm),
  });

  // New mtime + updated frontmatter title
  const updatedFm = new Map([["content/01.home/default.md", { title: "New Title" }]]);
  const storage: StorageAdapter = {
    listRecursive: () =>
      Promise.resolve([{ name: "default.md", path: "content/01.home/default.md", isFile: true, isDirectory: false }]),
    stat: () => Promise.resolve({ size: 100, mtime: 2000, isFile: true, isDirectory: false }), // different mtime
    readText: () => Promise.resolve("---\ntitle: New Title\n---\n"),
  } as unknown as StorageAdapter;

  const result = await updateIndex(initial.pages, initial.taxonomyMap, {
    storage,
    contentDir: "content",
    formats: makeFormats(updatedFm),
  });

  assertEquals(result.pages[0].title, "New Title");
});

Deno.test("updateIndex: deleted file is removed from result", async () => {
  const files = [fakeFile("01.home"), fakeFile("02.about")];
  const initial = await buildIndex({
    storage: makeStorage(files),
    contentDir: "content",
    formats: makeFormats(),
  });
  assertEquals(initial.pages.length, 2);

  // Only home remains in directory listing
  const storage: StorageAdapter = {
    listRecursive: () =>
      Promise.resolve([{ name: "default.md", path: "content/01.home/default.md", isFile: true, isDirectory: false }]),
    stat: () => Promise.resolve({ size: 100, mtime: 1000, isFile: true, isDirectory: false }),
    readText: () => Promise.resolve("---\ntitle: Home\n---\n"),
  } as unknown as StorageAdapter;

  const result = await updateIndex(initial.pages, initial.taxonomyMap, {
    storage,
    contentDir: "content",
    formats: makeFormats(),
  });

  assertEquals(result.pages.length, 1);
  assertEquals(result.pages[0].route, "/home");
});
