/**
 * Regression test: buildStatic() renders every route through the real
 * handler, but MDX compile failures never throw — MdxHandler.renderToHtml()
 * catches them internally and returns a normal 200 response with the error
 * embedded as `<div class="mdx-error">...</div>` (src/content/formats/mdx.ts).
 * Before this fix, buildStatic()'s try/catch around each route never saw
 * that failure — the page got written to dist/ and counted as rendered, and
 * `dune build` reported success while shipping a broken page to production.
 *
 * buildStatic() now inspects each HTML response body for the mdx-error
 * marker and records it in `result.errors`, matching how a thrown render
 * error is already reported.
 *
 * NOTE: bootstrap() starts a file-watcher interval that leaks across test
 * boundaries (same caveat as tests/cli/fresh-app_test.ts) — these tests use
 * { sanitizeOps: false, sanitizeResources: false }.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { join } from "@std/path";
import { bootstrap } from "../../src/runtime/bootstrap.ts";
import { buildStatic } from "../../src/ssg/builder.ts";
import type { SSGOptions } from "../../src/ssg/types.ts";

async function withTempSite(
  fn: (root: string) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "dune_test_ssg_builder_" });
  try {
    await fn(root);
  } finally {
    for (let attempt = 0; ; attempt++) {
      try {
        await Deno.remove(root, { recursive: true });
        break;
      } catch (err) {
        if (attempt >= 4) throw err;
        await new Promise((r) => setTimeout(r, 50));
      }
    }
  }
}

// Deliberately no themes/ directory and no theme: config here. Rendering
// through a real theme template requires Deno to dynamically import a .tsx
// file (src/themes/loader.ts's `import(fileUrl)`), which needs a deno.json
// with a preact jsxImportSource in scope to compile JSX — the temp site
// fixtures in these tests don't have one. Omitting the theme instead routes
// every page through content-handler.ts's built-in bare-fallback template
// (inline `h()` calls, no dynamic import), which is enough to exercise
// page.html() — the thing that actually triggers the MDX bug under test —
// without dragging in an unrelated JSX-compilation environment problem.

const ssgOpts: SSGOptions = {
  outDir: "dist",
  incremental: false,
  concurrency: 4,
  hybrid: false,
  includeDrafts: false,
  verbose: false,
};

Deno.test(
  "buildStatic: a page with a broken MDX body is reported in result.errors, not silently counted as rendered (regression: MDX errors never throw, so the build previously reported success)",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withTempSite(async (root) => {
      await Deno.mkdir(join(root, "content", "01.home"), { recursive: true });
      await Deno.writeTextFile(
        join(root, "content", "01.home", "default.md"),
        "---\ntitle: Home\n---\n\n# Home\n",
      );

      // Unclosed JSX tag — a genuine MDX compile error.
      await Deno.mkdir(join(root, "content", "02.broken"), { recursive: true });
      await Deno.writeTextFile(
        join(root, "content", "02.broken", "default.mdx"),
        "---\ntitle: Broken\n---\n\n<div>\n  <span>Unclosed\n",
      );

      const ctx = await bootstrap(root, {});
      const result = await buildStatic(root, ctx, ssgOpts);

      assertEquals(
        result.errors.some((e) => e.route === "/broken/"),
        true,
        `expected /broken/ in result.errors, got: ${JSON.stringify(result.errors)}`,
      );

      // The page is still written to disk (matches existing "non-2xx pages
      // still get written" behavior) — this is a reported failure, not a
      // missing file.
      const written = await Deno.readTextFile(join(root, "dist", "broken", "index.html"));
      assertEquals(written.includes("mdx-error"), true);
    });
  },
);

Deno.test(
  "buildStatic: a clean site reports zero errors (sanity check against false positives)",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withTempSite(async (root) => {
      await Deno.mkdir(join(root, "content", "01.home"), { recursive: true });
      await Deno.writeTextFile(
        join(root, "content", "01.home", "default.md"),
        "---\ntitle: Home\n---\n\n# Home\n",
      );
      await Deno.mkdir(join(root, "content", "02.fine"), { recursive: true });
      await Deno.writeTextFile(
        join(root, "content", "02.fine", "default.mdx"),
        "---\ntitle: Fine\n---\n\nJust **normal** MDX content.\n",
      );

      const ctx = await bootstrap(root, {});
      const result = await buildStatic(root, ctx, ssgOpts);

      assertEquals(result.errors, []);
    });
  },
);
