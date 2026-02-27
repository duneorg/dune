/**
 * Tests for the theme loader: manifest parsing, template/layout discovery,
 * theme inheritance chain, locale loading, and cache management.
 *
 * Note: loadTemplate() and loadLayout() rely on dynamic ESM imports of actual
 * .tsx files.  Those paths are covered at the integration level; here we verify
 * the null-fallback case (no file present) and all pure/storage-based logic.
 */

import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createThemeLoader } from "../../src/themes/loader.ts";
import type { StorageAdapter } from "../../src/storage/types.ts";
import type { Page, PageFrontmatter } from "../../src/content/types.ts";

// ---------------------------------------------------------------------------
// Storage stub
// ---------------------------------------------------------------------------

function makeStorage(files: Record<string, string> = {}): StorageAdapter {
  const dirs: Record<string, { name: string; isFile: boolean; isDirectory: boolean }[]> = {};

  // Pre-compute directory listings from the files map
  for (const path of Object.keys(files)) {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join("/");
      const name = parts[i];
      const isFile = i === parts.length - 1;
      if (!dirs[dir]) dirs[dir] = [];
      if (!dirs[dir].find((e) => e.name === name)) {
        dirs[dir].push({ name, isFile, isDirectory: !isFile });
      }
    }
  }

  return {
    exists: (path: string) => Promise.resolve(path in files),
    readText: (path: string) => {
      if (path in files) return Promise.resolve(files[path]);
      return Promise.reject(new Error(`Not found: ${path}`));
    },
    list: (dir: string) => Promise.resolve(dirs[dir] ?? []),
    // Unused by theme loader
    read: () => Promise.reject(new Error("read not supported")),
    write: () => Promise.reject(new Error("write not supported")),
    stat: () => Promise.reject(new Error("stat not supported")),
    delete: () => Promise.reject(new Error("delete not supported")),
    listRecursive: () => Promise.reject(new Error("listRecursive not supported")),
    writeText: () => Promise.reject(new Error("writeText not supported")),
  } as unknown as StorageAdapter;
}

// ---------------------------------------------------------------------------
// Page stub helpers
// ---------------------------------------------------------------------------

function makePage(overrides: Partial<Page> & { format?: string }): Page {
  const frontmatter: PageFrontmatter = {
    title: "Test",
    published: true,
    visible: true,
    taxonomy: {},
    ...((overrides as any).frontmatter ?? {}),
  };
  return {
    sourcePath: "01.test/default.md",
    route: "/test",
    language: "en",
    format: overrides.format ?? "md",
    template: overrides.template ?? "default",
    navTitle: "Test",
    frontmatter,
    rawContent: null,
    order: 1,
    depth: 0,
    isModule: false,
    media: [],
    html: () => Promise.resolve(""),
    component: () => Promise.resolve(null),
    summary: () => Promise.resolve(""),
    parent: () => Promise.resolve(null),
    children: () => Promise.resolve([]),
    siblings: () => Promise.resolve([]),
    modules: () => Promise.resolve([]),
    ...overrides,
  } as Page;
}

// ---------------------------------------------------------------------------
// Helper: create a minimal loader (no theme.yaml → fallback name)
// ---------------------------------------------------------------------------

async function makeLoader(
  themeName: string,
  files: Record<string, string> = {},
) {
  const storage = makeStorage(files);
  return createThemeLoader({
    storage,
    themesDir: "themes",
    themeName,
  });
}

// ---------------------------------------------------------------------------
// resolveTemplateName()
// ---------------------------------------------------------------------------

Deno.test("resolveTemplateName: returns null for .tsx pages", async () => {
  const loader = await makeLoader("base");
  const page = makePage({ format: "tsx" });
  assertEquals(loader.resolveTemplateName(page), null);
});

Deno.test("resolveTemplateName: uses explicit frontmatter.template", async () => {
  const loader = await makeLoader("base");
  const page = makePage({
    frontmatter: {
      title: "T", published: true, visible: true, taxonomy: {},
      template: "article",
    } as PageFrontmatter,
  });
  assertEquals(loader.resolveTemplateName(page), "article");
});

Deno.test("resolveTemplateName: uses page.template when not 'self'", async () => {
  const loader = await makeLoader("base");
  const page = makePage({ template: "post" });
  // frontmatter.template not set → falls through to page.template
  assertEquals(loader.resolveTemplateName(page), "post");
});

Deno.test("resolveTemplateName: falls back to 'default'", async () => {
  const loader = await makeLoader("base");
  // template = "self" triggers default fallback
  const page = makePage({ template: "self" });
  assertEquals(loader.resolveTemplateName(page), "default");
});

// ---------------------------------------------------------------------------
// Theme manifest loading
// ---------------------------------------------------------------------------

Deno.test("theme manifest: falls back to theme name when theme.yaml missing", async () => {
  const loader = await makeLoader("mytheme");
  assertEquals(loader.theme.manifest.name, "mytheme");
});

Deno.test("theme manifest: parses theme.yaml fields", async () => {
  const yaml = "name: Pretty Theme\ndescription: A nice theme\nauthor: Alice\nversion: 1.0.0\n";
  const loader = await makeLoader("pretty", {
    "themes/pretty/theme.yaml": yaml,
  });
  assertEquals(loader.theme.manifest.name, "Pretty Theme");
  assertEquals(loader.theme.manifest.description, "A nice theme");
  assertEquals(loader.theme.manifest.author, "Alice");
  assertEquals(loader.theme.manifest.version, "1.0.0");
});

Deno.test("theme manifest: falls back to theme name on malformed yaml", async () => {
  const loader = await makeLoader("broken", {
    "themes/broken/theme.yaml": ": : invalid yaml ::::",
  });
  // loadThemeManifest catches parse errors and returns { name: fallbackName }
  assertEquals(loader.theme.manifest.name, "broken");
});

// ---------------------------------------------------------------------------
// Template and layout discovery
// ---------------------------------------------------------------------------

Deno.test("discoverTemplates: returns empty list when templates/ missing", async () => {
  const loader = await makeLoader("empty");
  assertEquals(loader.theme.templateNames, []);
});

Deno.test("discoverTemplates: lists .tsx files in templates/ directory", async () => {
  const loader = await makeLoader("rich", {
    "themes/rich/templates/default.tsx": "export default () => null;",
    "themes/rich/templates/post.tsx": "export default () => null;",
    "themes/rich/templates/blog.tsx": "export default () => null;",
  });
  const names = loader.theme.templateNames.slice().sort();
  assertEquals(names, ["blog", "default", "post"]);
});

Deno.test("discoverTemplates: ignores non-.tsx files", async () => {
  const loader = await makeLoader("mixed", {
    "themes/mixed/templates/default.tsx": "export default () => null;",
    "themes/mixed/templates/readme.md": "# readme",
    "themes/mixed/templates/styles.css": "body {}",
  });
  assertEquals(loader.theme.templateNames, ["default"]);
});

Deno.test("discoverLayouts: returns empty list when components/ missing", async () => {
  const loader = await makeLoader("nocomp");
  assertEquals(loader.theme.layoutNames, []);
});

Deno.test("discoverLayouts: lists .tsx files in components/ directory", async () => {
  const loader = await makeLoader("layouted", {
    "themes/layouted/components/layout.tsx": "export default () => null;",
    "themes/layouted/components/nav.tsx": "export default () => null;",
  });
  const names = loader.theme.layoutNames.slice().sort();
  assertEquals(names, ["layout", "nav"]);
});

// ---------------------------------------------------------------------------
// Theme inheritance chain
// ---------------------------------------------------------------------------

Deno.test("theme inheritance: child theme has parent set", async () => {
  const yaml = "name: child\nparent: parent\n";
  const loader = await makeLoader("child", {
    "themes/child/theme.yaml": yaml,
    // parent theme has no yaml → fallback name
  });
  assertEquals(loader.theme.manifest.name, "child");
  assertEquals(loader.theme.parent !== undefined, true);
  assertEquals(loader.theme.parent!.manifest.name, "parent");
});

Deno.test("theme inheritance: top-level theme has no parent", async () => {
  const loader = await makeLoader("standalone");
  assertEquals(loader.theme.parent, undefined);
});

Deno.test("theme inheritance: circular detection throws", async () => {
  await assertRejects(
    () =>
      makeLoader("a", {
        "themes/a/theme.yaml": "name: a\nparent: b\n",
        "themes/b/theme.yaml": "name: b\nparent: a\n",
      }),
    Error,
    "Circular theme inheritance",
  );
});

// ---------------------------------------------------------------------------
// getAvailableTemplates()
// ---------------------------------------------------------------------------

Deno.test("getAvailableTemplates: returns templates from child theme only", async () => {
  const loader = await makeLoader("solo", {
    "themes/solo/templates/default.tsx": "",
    "themes/solo/templates/post.tsx": "",
  });
  const names = loader.getAvailableTemplates().sort();
  assertEquals(names, ["default", "post"]);
});

Deno.test("getAvailableTemplates: merges templates from child and parent", async () => {
  const loader = await makeLoader("child", {
    "themes/child/theme.yaml": "name: child\nparent: parent\n",
    "themes/child/templates/article.tsx": "",
    "themes/parent/templates/default.tsx": "",
    "themes/parent/templates/post.tsx": "",
  });
  const names = loader.getAvailableTemplates().sort();
  assertEquals(names, ["article", "default", "post"]);
});

Deno.test("getAvailableTemplates: deduplicates overridden templates", async () => {
  // child overrides "default" — should only appear once
  const loader = await makeLoader("child", {
    "themes/child/theme.yaml": "name: child\nparent: parent\n",
    "themes/child/templates/default.tsx": "",
    "themes/parent/templates/default.tsx": "",
    "themes/parent/templates/post.tsx": "",
  });
  const names = loader.getAvailableTemplates().sort();
  assertEquals(names, ["default", "post"]);
});

// ---------------------------------------------------------------------------
// loadTemplate() / loadLayout() — null fallback when no file present
// ---------------------------------------------------------------------------

Deno.test("loadTemplate: returns null when no template file exists", async () => {
  const loader = await makeLoader("empty");
  const result = await loader.loadTemplate("default");
  assertEquals(result, null);
});

Deno.test("loadLayout: returns null when no layout file exists", async () => {
  const loader = await makeLoader("empty");
  const result = await loader.loadLayout("layout");
  assertEquals(result, null);
});

Deno.test("loadTemplate: walks parent chain and returns null if not found anywhere", async () => {
  const loader = await makeLoader("child", {
    "themes/child/theme.yaml": "name: child\nparent: parent\n",
  });
  const result = await loader.loadTemplate("default");
  assertEquals(result, null);
});

// ---------------------------------------------------------------------------
// loadLocale()
// ---------------------------------------------------------------------------

Deno.test("loadLocale: returns empty object when no locale files exist", async () => {
  const loader = await makeLoader("base");
  const locale = await loader.loadLocale("en");
  assertEquals(locale, {});
});

Deno.test("loadLocale: parses JSON locale file", async () => {
  const loader = await makeLoader("base", {
    "themes/base/locales/en.json": JSON.stringify({ greeting: "Hello", farewell: "Goodbye" }),
  });
  const locale = await loader.loadLocale("en");
  assertEquals(locale.greeting, "Hello");
  assertEquals(locale.farewell, "Goodbye");
});

Deno.test("loadLocale: falls back to 'en' when requested language missing", async () => {
  const loader = await makeLoader("base", {
    "themes/base/locales/en.json": JSON.stringify({ greeting: "Hello" }),
  });
  // "fr" locale not present → should fall back to "en"
  const locale = await loader.loadLocale("fr");
  assertEquals(locale.greeting, "Hello");
});

Deno.test("loadLocale: merges child locale over 'en' fallback", async () => {
  const loader = await makeLoader("base", {
    "themes/base/locales/en.json": JSON.stringify({ greeting: "Hello", farewell: "Goodbye" }),
    "themes/base/locales/fr.json": JSON.stringify({ greeting: "Bonjour" }),
  });
  const locale = await loader.loadLocale("fr");
  // "fr" overrides "greeting", inherits "farewell" from en
  assertEquals(locale.greeting, "Bonjour");
  assertEquals(locale.farewell, "Goodbye");
});

Deno.test("loadLocale: walks parent theme chain for locale files", async () => {
  const loader = await makeLoader("child", {
    "themes/child/theme.yaml": "name: child\nparent: parent\n",
    // locale only in parent
    "themes/parent/locales/en.json": JSON.stringify({ key: "value" }),
  });
  const locale = await loader.loadLocale("en");
  assertEquals(locale.key, "value");
});

Deno.test("loadLocale: caches result on second call", async () => {
  let readCount = 0;
  const storage: StorageAdapter = {
    exists: (path: string) =>
      Promise.resolve(path === "themes/base/locales/en.json"),
    readText: (path: string) => {
      if (path === "themes/base/locales/en.json") {
        readCount++;
        return Promise.resolve(JSON.stringify({ k: "v" }));
      }
      return Promise.reject(new Error(`Not found: ${path}`));
    },
    list: () => Promise.resolve([]),
    read: () => Promise.reject(new Error("read not supported")),
    write: () => Promise.reject(new Error("write not supported")),
    stat: () => Promise.reject(new Error("stat not supported")),
    delete: () => Promise.reject(new Error("delete not supported")),
    listRecursive: () => Promise.reject(new Error("listRecursive not supported")),
    writeText: () => Promise.reject(new Error("writeText not supported")),
  } as unknown as StorageAdapter;

  const loader = await createThemeLoader({ storage, themesDir: "themes", themeName: "base" });
  await loader.loadLocale("en");
  await loader.loadLocale("en"); // second call should use cache
  assertEquals(readCount, 1);
});

// ---------------------------------------------------------------------------
// clearCache()
// ---------------------------------------------------------------------------

Deno.test("clearCache: clears locale cache so locale is re-read", async () => {
  let readCount = 0;
  const files: Record<string, string> = {
    "themes/base/locales/en.json": JSON.stringify({ k: "v1" }),
  };
  const storage = makeStorage(files);
  // Override readText to count calls
  const origReadText = storage.readText.bind(storage);
  (storage as any).readText = (path: string) => {
    if (path.endsWith(".json")) readCount++;
    return origReadText(path);
  };

  const loader = await createThemeLoader({ storage, themesDir: "themes", themeName: "base" });

  const first = await loader.loadLocale("en");
  assertEquals(first.k, "v1");
  assertEquals(readCount, 1);

  // Simulate file change
  files["themes/base/locales/en.json"] = JSON.stringify({ k: "v2" });
  loader.clearCache();

  const second = await loader.loadLocale("en");
  assertEquals(second.k, "v2");
  assertEquals(readCount, 2); // re-read after cache clear
});
