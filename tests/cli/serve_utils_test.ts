/**
 * Tests for shared HTTP-serving utilities.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  injectBasePath,
  isAdminPath,
  servePluginAsset,
  serveStaticFile,
} from "../../src/cli/serve-utils.ts";

async function bodyOf(response: Response): Promise<string> {
  return await response.text();
}

function htmlResponse(html: string): Response {
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

Deno.test("isAdminPath: matches the admin root and nested paths", () => {
  assertEquals(isAdminPath("/admin", "/admin"), true);
  assertEquals(isAdminPath("/admin/pages", "/admin"), true);
  assertEquals(isAdminPath("/admin/api/content/x", "/admin"), true);
});

Deno.test("isAdminPath: does not match sibling routes sharing the prefix string", () => {
  assertEquals(isAdminPath("/administrivia", "/admin"), false);
  assertEquals(isAdminPath("/admin-blog", "/admin"), false);
  assertEquals(isAdminPath("/", "/admin"), false);
  assertEquals(isAdminPath("/about", "/admin"), false);
});

Deno.test("isAdminPath: respects custom admin prefixes", () => {
  assertEquals(isAdminPath("/backstage", "/backstage"), true);
  assertEquals(isAdminPath("/backstage/users", "/backstage"), true);
  assertEquals(isAdminPath("/backstage-door", "/backstage"), false);
});

// === injectBasePath (multisite path_prefix routing) ===

Deno.test("injectBasePath: no-op when basePath is unset", async () => {
  const res = injectBasePath(htmlResponse('<a href="/blog">Blog</a>'), undefined);
  assertEquals(await bodyOf(res), '<a href="/blog">Blog</a>');
});

Deno.test("injectBasePath: no-op for non-HTML responses", async () => {
  const res = injectBasePath(
    new Response('<a href="/blog">Blog</a>', { headers: { "Content-Type": "application/json" } }),
    "/papermod",
  );
  assertEquals(await bodyOf(res), '<a href="/blog">Blog</a>');
});

Deno.test("injectBasePath: prefixes root-relative href/src/action", async () => {
  const html = '<a href="/">Home</a><a href="/blog/post">Post</a>' +
    '<link href="/themes/papermod/static/style.css" rel="stylesheet">' +
    '<form action="/search"></form>';
  const res = injectBasePath(htmlResponse(html), "/papermod");
  const out = await bodyOf(res);

  assertEquals(
    out,
    '<a href="/papermod/">Home</a><a href="/papermod/blog/post">Post</a>' +
      '<link href="/papermod/themes/papermod/static/style.css" rel="stylesheet">' +
      '<form action="/papermod/search"></form>',
  );
});

Deno.test("injectBasePath: leaves absolute and protocol-relative URLs untouched", async () => {
  const html = '<a href="https://example.com/x">abs</a><a href="//cdn.example.com/x">proto-relative</a>' +
    '<a href="mailto:hi@example.com">mail</a>';
  const res = injectBasePath(htmlResponse(html), "/papermod");
  assertEquals(await bodyOf(res), html);
});

Deno.test("injectBasePath: is idempotent — doesn't double-prefix already-prefixed paths", async () => {
  const html = '<a href="/papermod/blog/post">Post</a>';
  const res = injectBasePath(htmlResponse(html), "/papermod");
  assertEquals(await bodyOf(res), html);
});

Deno.test("injectBasePath: normalizes a trailing slash on basePath", async () => {
  const res = injectBasePath(htmlResponse('<a href="/blog">Blog</a>'), "/papermod/");
  assertEquals(await bodyOf(res), '<a href="/papermod/blog">Blog</a>');
});

// === serveStaticFile / servePluginAsset: percent-encoded paths ===

/** A site root with static files (incl. spaces/non-ASCII names) and a secret outside static/. */
async function makeStaticRoot(): Promise<{ root: string; shared: string; cleanup: () => Promise<void> }> {
  const base = await Deno.makeTempDir();
  const root = `${base}/site`;
  const shared = `${base}/shared-themes`;
  await Deno.mkdir(`${root}/static/docs`, { recursive: true });
  await Deno.mkdir(`${root}/themes/mine/static`, { recursive: true });
  await Deno.mkdir(`${shared}/other/static`, { recursive: true });
  await Deno.writeTextFile(`${root}/static/plain.txt`, "plain");
  await Deno.writeTextFile(`${root}/static/My File.pdf`, "spaced");
  await Deno.writeTextFile(`${root}/static/docs/Littérature & Suisse.txt`, "unicode");
  await Deno.writeTextFile(`${root}/static/100%25.txt`, "literal percent sequence");
  await Deno.writeTextFile(`${root}/themes/mine/static/theme file.css`, "themed");
  await Deno.writeTextFile(`${root}/secret.txt`, "SECRET");
  await Deno.writeTextFile(`${base}/outside-secret.txt`, "SECRET");
  await Deno.writeTextFile(`${shared}/other/static/ok.css`, "shared");
  return { root, shared, cleanup: () => Deno.remove(base, { recursive: true }) };
}

Deno.test("serveStaticFile: serves files whose names need percent-encoding", async () => {
  const { root, cleanup } = await makeStaticRoot();
  try {
    assertEquals(await (await serveStaticFile(root, "/static/plain.txt"))!.text(), "plain");
    assertEquals(await (await serveStaticFile(root, "/static/My%20File.pdf"))!.text(), "spaced");
    assertEquals(
      await (await serveStaticFile(root, "/static/docs/Litt%C3%A9rature%20%26%20Suisse.txt"))!.text(),
      "unicode",
    );
    assertEquals(
      await (await serveStaticFile(root, "/themes/mine/static/theme%20file.css"))!.text(),
      "themed",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("serveStaticFile: decodes exactly once (double-encoded input is a literal name)", async () => {
  const { root, cleanup } = await makeStaticRoot();
  try {
    // "%25" decodes to "%", which is then NOT decoded again: this addresses "100%25.txt"
    assertEquals(await (await serveStaticFile(root, "/static/100%2525.txt"))!.text(), "literal percent sequence");
    // ...so a double-encoded traversal is just a nonexistent literal file name
    assertEquals(await serveStaticFile(root, "/static/%252e%252e%252fsecret.txt"), null);
  } finally {
    await cleanup();
  }
});

Deno.test("serveStaticFile: rejects encoded traversal, NUL, backslash and malformed encodings", async () => {
  const { root, shared, cleanup } = await makeStaticRoot();
  try {
    for (
      const p of [
        "/static/%2e%2e/secret.txt",
        "/static/%2E%2E%2Fsecret.txt",
        "/static/..%2fsecret.txt",
        "/static/docs/%2e%2e/%2e%2e/secret.txt",
        "/static/%2e%2e%5csecret.txt",
        "/static/plain.txt%00.png",
        "/static/%5Csecret.txt",
        "/static/%E0%A4%A",
        "/static/%2Fetc%2Fpasswd",
      ]
    ) {
      assertEquals(await serveStaticFile(root, p), null, p);
    }
    // theme-name segment: "%2e%2e" must not climb out of themes/<name>/ (incl. the shared dir)
    for (const p of ["/themes/%2e%2e/static/ok.css", "/themes/%2E%2E/static/outside-secret.txt"]) {
      assertEquals(await serveStaticFile(root, p, false, { sharedThemesDir: shared }), null, p);
    }
    // a legitimate shared theme asset still resolves
    assertEquals(
      await (await serveStaticFile(root, "/themes/other/static/ok.css", false, { sharedThemesDir: shared }))!.text(),
      "shared",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("servePluginAsset: serves encoded names and rejects encoded traversal", async () => {
  const base = await Deno.makeTempDir();
  try {
    const assets = `${base}/assets`;
    await Deno.mkdir(assets, { recursive: true });
    await Deno.writeTextFile(`${assets}/my asset.js`, "asset");
    await Deno.writeTextFile(`${base}/secret.txt`, "SECRET");
    const dirs = new Map([["demo", assets]]);
    assertEquals(await (await servePluginAsset(dirs, "/plugins/demo/my%20asset.js"))!.text(), "asset");
    for (const p of ["/plugins/demo/%2e%2e/secret.txt", "/plugins/demo/..%2fsecret.txt", "/plugins/demo/%E0%A4%A"]) {
      assertEquals(await servePluginAsset(dirs, p), null, p);
    }
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});
