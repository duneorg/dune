/**
 * Tests for the theme preview handler in the admin server.
 *
 * Covers:
 *  - Invalid (unknown) theme name → 404 HTML
 *  - Route not found in page index → 404 HTML
 *  - TSX format page → TSX fallback notice HTML (200)
 *  - md/mdx page, preview theme has no matching template → minimal HTML fallback (200)
 *  - md/mdx page with a matching template → rendered via template (200)
 */

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createAdminHandler } from "../../src/admin/server.ts";
import type { DuneEngine } from "../../src/core/engine.ts";
import type { AuthResult } from "../../src/admin/types.ts";
import type { PageIndex } from "../../src/content/types.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function memStorage() {
  const files = new Map<string, Uint8Array>();
  return {
    async read(path: string) {
      const d = files.get(path);
      if (!d) throw new Error(`Not found: ${path}`);
      return d;
    },
    async readText(path: string) {
      const d = files.get(path);
      if (!d) throw new Error(`Not found: ${path}`);
      return new TextDecoder().decode(d);
    },
    async write(path: string, data: Uint8Array) {
      files.set(path, data);
    },
    async exists(path: string) {
      return files.has(path);
    },
    async delete(path: string) {
      files.delete(path);
    },
    async list(_dir: string) {
      return [];
    },
    async stat(path: string) {
      const d = files.get(path);
      if (!d) throw new Error(`Not found: ${path}`);
      return { size: d.length, mtime: Date.now(), isFile: true, isDirectory: false };
    },
  } as any;
}

function alwaysAuthMiddleware() {
  const adminUser = {
    id: "u1",
    username: "admin",
    name: "Admin",
    email: "admin@example.com",
    role: "admin" as const,
    enabled: true,
    passwordHash: "",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const authResult: AuthResult = {
    authenticated: true,
    user: adminUser,
    session: { id: "s1", userId: "u1", createdAt: Date.now(), expiresAt: Date.now() + 1e9 },
  };
  return {
    authenticate: async (_req: Request) => authResult,
    hasPermission: (_auth: AuthResult, _perm: string) => true,
    createSessionCookie: () => "",
    clearSessionCookie: () => "",
  } as any;
}

function stubUsers() {
  return {
    list: async () => [],
    getByUsername: async () => null,
    getById: async () => null,
    create: async () => { throw new Error("not implemented"); },
    update: async () => { throw new Error("not implemented"); },
    updatePassword: async () => { throw new Error("not implemented"); },
    delete: async () => { throw new Error("not implemented"); },
  } as any;
}

function stubSessions() {
  return {
    create: async () => ({ id: "s1", userId: "u1", createdAt: Date.now(), expiresAt: Date.now() + 1e9 }),
    get: async () => null,
    revoke: async () => {},
    revokeAll: async () => {},
  } as any;
}

function stubConfig() {
  return {
    config: {
      site: { title: "Test Site", url: "http://localhost", description: "", author: { name: "Test" }, taxonomies: [] },
      system: {
        content: { dir: "content" },
        cache: { enabled: false, driver: "memory", lifetime: 3600, check: "file" },
        images: { default_quality: 80, allowed_sizes: [400, 800, 1200] },
        languages: { supported: ["en"], default: "en", include_default_in_url: false },
        debug: false,
        timezone: "UTC",
      },
      theme: { name: "default" },
      plugins: {},
      pluginList: [],
      admin: { prefix: "/admin", dataDir: "data", sessionLifetime: 86400 },
    },
    site: { title: "Test Site" },
    theme: { name: "default" },
    admin: { prefix: "/admin", dataDir: "data", sessionLifetime: 86400 },
    system: {
      content: { dir: "content" },
      cache: { enabled: false, driver: "memory", lifetime: 3600, check: "file" },
      images: { default_quality: 80, allowed_sizes: [400, 800, 1200] },
      languages: { supported: ["en"], default: "en", include_default_in_url: false },
      debug: false,
      timezone: "UTC",
    },
  } as any;
}

/** Create a minimal DuneEngine stub for preview tests */
function makePreviewEngine(
  opts: {
    availableThemes?: string[];
    pages?: PageIndex[];
    createPreviewTheme?: (name: string) => Promise<any>;
    loadPage?: (path: string) => Promise<any>;
  } = {},
): DuneEngine {
  const {
    availableThemes = ["default"],
    pages = [],
    createPreviewTheme = (_name: string) => Promise.reject(new Error("no loader")),
    loadPage = (_path: string) => Promise.reject(new Error("not implemented")),
  } = opts;

  return {
    config: stubConfig(),
    site: { title: "Test Site" },
    pages,
    blueprints: {},
    taxonomyMap: {},
    router: {
      getNavigation: () => [],
      getTopNavigation: () => [],
      resolve: () => ({ type: "not-found" }),
    } as any,
    themes: {
      theme: { manifest: { name: "default", configSchema: {} } },
      resolveTemplateName: () => null,
      loadTemplate: () => Promise.resolve(null),
      loadLayout: () => Promise.resolve(null),
      loadLocale: () => Promise.resolve({}),
      clearCache: () => {},
    } as any,
    init: () => Promise.resolve(),
    resolve: () => Promise.resolve({ type: "not-found" }),
    loadPage,
    serveMedia: () => Promise.resolve(null),
    rebuild: () => Promise.resolve(),
    themeConfig: {},
    getAvailableThemes: () => Promise.resolve(availableThemes),
    switchTheme: () => Promise.resolve(),
    createPreviewTheme,
  } as unknown as DuneEngine;
}

/** Create an admin handler pointed at /admin */
function makeHandler(engine: DuneEngine) {
  const storage = memStorage();
  // Seed a minimal admin users file so the handler initialises without crash
  storage.write("data/admin-users.json", new TextEncoder().encode("[]"));

  return createAdminHandler({
    engine,
    storage,
    config: stubConfig(),
    auth: alwaysAuthMiddleware(),
    users: stubUsers(),
    sessions: stubSessions(),
    prefix: "/admin",
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

Deno.test("theme-preview: unknown theme name returns 404", async () => {
  const handler = makeHandler(makePreviewEngine({ availableThemes: ["default"] }));

  const req = new Request("http://localhost/admin/api/theme-preview?theme=nonexistent&route=/");
  const resp = await handler(req);

  assertEquals(resp?.status, 404);
  const body = await resp!.text();
  assertStringIncludes(body, "nonexistent");
});

Deno.test("theme-preview: route not found returns 404", async () => {
  const handler = makeHandler(makePreviewEngine({
    availableThemes: ["minimal"],
    pages: [], // no pages at all
  }));

  const req = new Request("http://localhost/admin/api/theme-preview?theme=minimal&route=/missing");
  const resp = await handler(req);

  assertEquals(resp?.status, 404);
  const body = await resp!.text();
  assertStringIncludes(body, "/missing");
});

Deno.test("theme-preview: TSX page returns 200 with fallback notice", async () => {
  const tsxPage: PageIndex = {
    sourcePath: "content/01.home/default.tsx",
    route: "/",
    language: "en",
    format: "tsx",
    template: "default",
    title: "Home",
    navTitle: "Home",
    date: null,
    published: true,
    status: "published",
    visible: true,
    routable: true,
    isModule: false,
    order: 0,
    depth: 0,
    parentPath: null,
    taxonomy: {},
    mtime: Date.now(),
    hash: "abc",
  };

  const handler = makeHandler(makePreviewEngine({
    availableThemes: ["minimal"],
    pages: [tsxPage],
  }));

  const req = new Request("http://localhost/admin/api/theme-preview?theme=minimal&route=/");
  const resp = await handler(req);

  assertEquals(resp?.status, 200);
  const body = await resp!.text();
  // Should contain the TSX notice, not an error
  assertStringIncludes(body, "TSX");
});

Deno.test("theme-preview: md page with no template returns minimal HTML fallback", async () => {
  const mdPage: PageIndex = {
    sourcePath: "content/01.home/default.md",
    route: "/",
    language: "en",
    format: "md",
    template: "default",
    title: "Welcome",
    navTitle: "Welcome",
    date: null,
    published: true,
    status: "published",
    visible: true,
    routable: true,
    isModule: false,
    order: 0,
    depth: 0,
    parentPath: null,
    taxonomy: {},
    mtime: Date.now(),
    hash: "abc",
  };

  // Preview theme loader that returns null for loadTemplate (no template found)
  const noTemplateLoader = {
    theme: { manifest: { name: "minimal" } },
    resolveTemplateName: () => "default",
    loadTemplate: (_name: string) => Promise.resolve(null),
    loadLayout: (_name: string) => Promise.resolve(null),
    loadLocale: (_lang: string) => Promise.resolve({}),
    clearCache: () => {},
  };

  const handler = makeHandler(makePreviewEngine({
    availableThemes: ["minimal"],
    pages: [mdPage],
    createPreviewTheme: (_name: string) => Promise.resolve(noTemplateLoader),
    loadPage: (_path: string) =>
      Promise.resolve({
        sourcePath: "content/01.home/default.md",
        format: "md",
        frontmatter: { title: "Welcome" },
        html: () => Promise.resolve("<p>Hello world</p>"),
        language: "en",
      }),
  }));

  const req = new Request("http://localhost/admin/api/theme-preview?theme=minimal&route=/");
  const resp = await handler(req);

  assertEquals(resp?.status, 200);
  const body = await resp!.text();
  // Minimal fallback wraps page HTML in a simple shell
  assertStringIncludes(body, "Hello world");
});

Deno.test("theme-preview: md page with template renders 200 HTML", async () => {
  const mdPage: PageIndex = {
    sourcePath: "content/01.blog/01.post/default.md",
    route: "/blog/post",
    language: "en",
    format: "md",
    template: "post",
    title: "My Post",
    navTitle: "My Post",
    date: "2026-03-09",
    published: true,
    status: "published",
    visible: true,
    routable: true,
    isModule: false,
    order: 1,
    depth: 1,
    parentPath: null,
    taxonomy: {},
    mtime: Date.now(),
    hash: "abc123",
  };

  // A minimal Preact-compatible component for the template
  const { h } = await import("preact");
  const templateComponent = (props: any) =>
    h("html", null,
      h("head", null, h("title", null, props.pageTitle)),
      h("body", null,
        h("h1", null, props.page?.frontmatter?.title ?? ""),
        props.children,
      ),
    );

  const withTemplateLoader = {
    theme: { manifest: { name: "minimal" } },
    resolveTemplateName: () => "post",
    loadTemplate: (_name: string) =>
      Promise.resolve({ name: "post", component: templateComponent, fromTheme: "minimal" }),
    loadLayout: (_name: string) => Promise.resolve(null),
    loadLocale: (_lang: string) => Promise.resolve({}),
    clearCache: () => {},
  };

  const handler = makeHandler(makePreviewEngine({
    availableThemes: ["minimal"],
    pages: [mdPage],
    createPreviewTheme: (_name: string) => Promise.resolve(withTemplateLoader),
    loadPage: (_path: string) =>
      Promise.resolve({
        sourcePath: "content/01.blog/01.post/default.md",
        format: "md",
        frontmatter: { title: "My Post" },
        html: () => Promise.resolve("<p>Post body content</p>"),
        language: "en",
      }),
  }));

  const req = new Request(
    "http://localhost/admin/api/theme-preview?theme=minimal&route=/blog/post",
  );
  const resp = await handler(req);

  assertEquals(resp?.status, 200);
  const body = await resp!.text();
  assertStringIncludes(body, "My Post");
  assertStringIncludes(body, "Post body content");
});
