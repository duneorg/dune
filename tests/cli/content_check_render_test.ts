/**
 * Regression tests for `dune content:check --render`.
 *
 * content:check's default checks (missing title, duplicate routes, future
 * dates, index errors) only ever look at frontmatter — the content index
 * never compiles a page's body. A page can index cleanly and still fail to
 * render (a bad MDX expression, an unclosed JSX tag), and that failure was
 * previously invisible to content:check entirely — "N pages checked" gave
 * no signal about whether any of them actually compile.
 *
 * The opt-in --render pass now loads and renders every md/mdx page body and
 * reports failures as ordinary issues, catching both thrown render errors
 * and MDX's internally-swallowed compile errors (MDX_ERROR_CLASS — see
 * tests/ssg/builder_test.ts for the sibling regression in `dune build`).
 *
 * NOTE: bootstrap() starts a file-watcher interval that leaks across test
 * boundaries (same caveat as tests/cli/validate_test.ts) — these tests use
 * { sanitizeOps: false, sanitizeResources: false }.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { join } from "@std/path";
import { contentCommands } from "../../src/cli/content.ts";

async function withTempSite(
  fn: (root: string) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "dune_test_content_check_render_" });
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

async function writeBrokenSite(root: string): Promise<void> {
  await Deno.mkdir(join(root, "content", "01.home"), { recursive: true });
  await Deno.writeTextFile(
    join(root, "content", "01.home", "default.md"),
    "---\ntitle: Home\n---\n\n# Home\n",
  );

  // Indexes cleanly (frontmatter is valid) but fails to compile — an
  // unclosed JSX tag in the MDX body.
  await Deno.mkdir(join(root, "content", "02.broken"), { recursive: true });
  await Deno.writeTextFile(
    join(root, "content", "02.broken", "default.mdx"),
    "---\ntitle: Broken\n---\n\n<div>\n  <span>Unclosed\n",
  );
}

async function runCheck(root: string, opts: { render?: boolean }) {
  const lines: string[] = [];
  const origLog = console.log;
  const origExit = Deno.exit;
  console.log = (...args: unknown[]) => lines.push(String(args[0]));
  Deno.exit = ((_code?: number) => {
    throw new Error("exit");
  }) as typeof Deno.exit;
  try {
    await contentCommands.check(root, { json: true, render: opts.render });
  } catch {
    // Expected — check() exits 1 in JSON mode when issues are found.
  } finally {
    console.log = origLog;
    Deno.exit = origExit;
  }
  return JSON.parse(lines.join(""));
}

Deno.test(
  "content:check without --render: a page with a broken MDX body reports no issues (regression baseline — frontmatter-only checks can't see it)",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withTempSite(async (root) => {
      await writeBrokenSite(root);
      const output = await runCheck(root, {});
      assertEquals(output.valid, true);
      assertEquals(output.issues, []);
    });
  },
);

Deno.test(
  "content:check --render: a page with a broken MDX body is reported as a failed-to-render issue",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withTempSite(async (root) => {
      await writeBrokenSite(root);
      const output = await runCheck(root, { render: true });
      assertEquals(output.valid, false);
      assertEquals(
        output.issues.some((i: { sourcePath: string; message: string }) =>
          i.sourcePath.includes("broken") && i.message.startsWith("Failed to render")
        ),
        true,
        `expected a "Failed to render" issue for 02.broken, got: ${JSON.stringify(output.issues)}`,
      );
    });
  },
);

Deno.test(
  "content:check --render: a clean site reports no render issues (sanity check against false positives)",
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

      const output = await runCheck(root, { render: true });
      assertEquals(output.valid, true);
      assertEquals(output.pagesRendered, 2);
    });
  },
);
