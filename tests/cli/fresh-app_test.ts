/**
 * Integration tests for src/cli/fresh-app.ts — createDuneApp().
 *
 * Boots a real Dune engine (bootstrap()) against a temp content tree, wires
 * it into a real Fresh App (createDuneApp()), and drives it through
 * App.handler() — Fresh's documented "use in testing" entry point — with
 * real fetch Requests. No mocking of the engine, storage, or routing.
 *
 * Regression coverage: content page-folders named "plugins" or "themes"
 * collide with the reserved /static/, /themes/, /plugins/ wildcard routes.
 * Those routes must fall through to routes.contentHandler when the
 * static/plugin-asset lookup misses, instead of 404ing from the wrong layer.
 *
 * NOTE: bootstrap() starts a file-watcher interval that leaks across test
 * boundaries (same caveat as content_delete_test.ts) — all tests here use
 * { sanitizeOps: false, sanitizeResources: false }.
 */

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { join } from "@std/path";
import { bootstrap } from "../../src/cli/bootstrap.ts";
import { createDuneApp } from "../../src/cli/fresh-app.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function writePage(
  root: string,
  dirName: string,
  title: string,
): Promise<void> {
  const dir = join(root, "content", dirName);
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(
    join(dir, "default.md"),
    `---\ntitle: ${title}\n---\n\n# ${title}\n`,
  );
}

/**
 * Build a minimal real site: a home page plus content page-folders named
 * "plugins" and "themes" (the exact collision that caused the regression),
 * and a real static asset under themes/default/static/ to verify the asset
 * path still works once it falls through to content on a miss.
 */
async function withTestApp(
  fn: (handler: (req: Request) => Promise<Response>, root: string) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "dune_test_freshapp_" });
  try {
    await writePage(root, "01.home", "Home");
    await writePage(root, "plugins", "Plugins Page");
    await writePage(root, "themes", "Themes Page");

    await Deno.mkdir(join(root, "themes", "default", "static"), { recursive: true });
    await Deno.writeTextFile(
      join(root, "themes", "default", "static", "style.css"),
      "body { color: red; }",
    );

    const ctx = await bootstrap(root, {});
    const { app } = await createDuneApp(ctx, { root, port: 0, dev: false });
    const handler = app.handler();

    await fn(handler, root);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// Regression: page-folders named "plugins" / "themes" reach their content
// ---------------------------------------------------------------------------

Deno.test(
  "createDuneApp: content page-folder named 'plugins' resolves at its canonical URL",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withTestApp(async (handler) => {
      const res = await handler(new Request("http://localhost/plugins/"));
      assertEquals(res.status, 200);
      const body = await res.text();
      assertStringIncludes(body, "Plugins Page");
    });
  },
);

Deno.test(
  "createDuneApp: content page-folder named 'themes' resolves at its canonical URL",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withTestApp(async (handler) => {
      const res = await handler(new Request("http://localhost/themes/"));
      assertEquals(res.status, 200);
      const body = await res.text();
      assertStringIncludes(body, "Themes Page");
    });
  },
);

// ---------------------------------------------------------------------------
// Real static/theme assets still serve through the same wildcard routes
// ---------------------------------------------------------------------------

Deno.test(
  "createDuneApp: real theme static asset still serves through /themes/*",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withTestApp(async (handler) => {
      const res = await handler(
        new Request("http://localhost/themes/default/static/style.css"),
      );
      assertEquals(res.status, 200);
      const body = await res.text();
      assertStringIncludes(body, "color: red");
    });
  },
);

// ---------------------------------------------------------------------------
// Genuinely missing paths still 404 through the same code path
// ---------------------------------------------------------------------------

Deno.test(
  "createDuneApp: nonexistent path under /plugins/ still 404s",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withTestApp(async (handler) => {
      const res = await handler(
        new Request("http://localhost/plugins/does-not-exist.js"),
      );
      assertEquals(res.status, 404);
    });
  },
);

Deno.test(
  "createDuneApp: nonexistent path under /themes/ still 404s",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withTestApp(async (handler) => {
      const res = await handler(
        new Request("http://localhost/themes/default/static/does-not-exist.css"),
      );
      assertEquals(res.status, 404);
    });
  },
);

Deno.test(
  "createDuneApp: genuinely nonexistent content route 404s",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withTestApp(async (handler) => {
      const res = await handler(new Request("http://localhost/nonexistent-page/"));
      assertEquals(res.status, 404);
    });
  },
);

// ---------------------------------------------------------------------------
// Sanity: the home page itself still resolves normally
// ---------------------------------------------------------------------------

Deno.test(
  "createDuneApp: home page resolves normally",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withTestApp(async (handler) => {
      const res = await handler(new Request("http://localhost/home/"));
      assertEquals(res.status, 200);
      const body = await res.text();
      assertStringIncludes(body, "Home");
    });
  },
);
