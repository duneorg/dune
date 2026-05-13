/**
 * Tests for src/cli/content-delete.ts — dune content:delete command.
 *
 * Uses a temporary filesystem (withTempSite helper) to isolate each test.
 *
 * NOTE: bootstrap() starts a file-watcher interval that leaks across test
 * boundaries. Tests that exercise the bootstrap path use
 * { sanitizeOps: false, sanitizeResources: false } to avoid false failures.
 */

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { join } from "@std/path";
import { contentDeleteCommand } from "../../src/cli/content-delete.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function withTempSite(
  fn: (root: string) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "dune_test_delete_" });
  try {
    await Deno.mkdir(join(root, "content"), { recursive: true });
    await fn(root);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

async function createFolderPage(
  root: string,
  dirName: string,
  content = "---\ntitle: Test\n---\n\n# Test\n",
): Promise<void> {
  const dir = join(root, "content", dirName);
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(join(dir, "default.md"), content);
}

async function createFlatPage(
  root: string,
  fileName: string,
  content = "---\ntitle: Test\n---\n\n# Test\n",
): Promise<void> {
  await Deno.writeTextFile(join(root, "content", fileName), content);
}

/**
 * Capture lines written to console.log, then restore it.
 * Returns the raw captured lines.
 */
function captureLog(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...args: unknown[]) => lines.push(args.join(" "));
  return { lines, restore: () => { console.log = orig; } };
}

/** Extract the first JSON object from captured output lines. */
function extractJson(lines: string[]): unknown {
  const jsonLine = lines.find((l) => l.trim().startsWith("{"));
  if (!jsonLine) throw new Error(`No JSON line found in: ${lines.join("\n")}`);
  return JSON.parse(jsonLine);
}

// ---------------------------------------------------------------------------
// Safety gate — no --confirm or --dry-run
// ---------------------------------------------------------------------------

Deno.test("content:delete exits 1 without --confirm or --dry-run", async () => {
  await withTempSite(async (root) => {
    await createFolderPage(root, "01.blog");

    const origExit = Deno.exit;
    let exitCode: number | undefined;
    Deno.exit = (code?: number) => {
      exitCode = code;
      throw new Error(`exit:${code}`);
    };

    try {
      await contentDeleteCommand(root, "/blog", {});
    } catch { /* expected */ } finally {
      Deno.exit = origExit;
    }

    assertEquals(exitCode, 1);
  });
});

// ---------------------------------------------------------------------------
// --dry-run tests (no bootstrap needed; findContentFile fallback)
// ---------------------------------------------------------------------------

Deno.test(
  "content:delete --dry-run reports folder page without deleting",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withTempSite(async (root) => {
      await createFolderPage(root, "01.blog");

      const { lines, restore } = captureLog();
      await contentDeleteCommand(root, "/blog", { dryRun: true });
      restore();

      const combined = lines.join("\n");
      assertStringIncludes(combined, "Would delete");

      // File must still exist
      const stat = await Deno.stat(join(root, "content", "01.blog", "default.md"));
      assertEquals(stat.isFile, true);
    });
  },
);

Deno.test(
  "content:delete --dry-run --json reports structured output",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withTempSite(async (root) => {
      await createFolderPage(root, "about");

      const { lines, restore } = captureLog();
      await contentDeleteCommand(root, "/about", { dryRun: true, json: true });
      restore();

      const data = extractJson(lines) as Record<string, unknown>;
      assertEquals(data.dryRun, true);
      assertEquals(data.route, "/about");
      assertEquals(Array.isArray(data.wouldDelete), true);
      assertEquals((data.wouldDelete as unknown[]).length > 0, true);
    });
  },
);

// ---------------------------------------------------------------------------
// --confirm: folder-based pages
// ---------------------------------------------------------------------------

Deno.test(
  "content:delete --confirm deletes folder-based page",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withTempSite(async (root) => {
      await createFolderPage(root, "01.blog");

      await contentDeleteCommand(root, "/blog", { confirm: true });

      // File gone
      let fileGone = false;
      try { await Deno.stat(join(root, "content", "01.blog", "default.md")); }
      catch { fileGone = true; }
      assertEquals(fileGone, true, "default.md should be deleted");

      // Empty parent folder also gone
      let dirGone = false;
      try { await Deno.stat(join(root, "content", "01.blog")); }
      catch { dirGone = true; }
      assertEquals(dirGone, true, "Empty parent folder should be removed");
    });
  },
);

Deno.test(
  "content:delete --confirm keeps parent folder when other files remain",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withTempSite(async (root) => {
      const dir = join(root, "content", "01.blog");
      await Deno.mkdir(dir, { recursive: true });
      await Deno.writeTextFile(join(dir, "default.md"), "---\ntitle: Blog\n---\n");
      await Deno.writeTextFile(join(dir, "extra.txt"), "extra");

      await contentDeleteCommand(root, "/blog", { confirm: true });

      // default.md gone
      let fileGone = false;
      try { await Deno.stat(join(dir, "default.md")); }
      catch { fileGone = true; }
      assertEquals(fileGone, true, "default.md should be deleted");

      // Folder remains (has extra.txt)
      const stat = await Deno.stat(dir);
      assertEquals(stat.isDirectory, true, "Non-empty parent folder should remain");
    });
  },
);

Deno.test(
  "content:delete --confirm --json returns structured success for folder page",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withTempSite(async (root) => {
      await createFolderPage(root, "01.blog");

      const { lines, restore } = captureLog();
      await contentDeleteCommand(root, "/blog", { confirm: true, json: true });
      restore();

      const data = extractJson(lines) as Record<string, unknown>;
      assertEquals(data.deleted, true);
      assertEquals(data.route, "/blog");
      assertEquals(Array.isArray(data.files), true);
    });
  },
);

// ---------------------------------------------------------------------------
// --confirm: flat .md pages
// ---------------------------------------------------------------------------

Deno.test(
  "content:delete --confirm deletes flat .md page",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withTempSite(async (root) => {
      await createFlatPage(root, "about.md");

      await contentDeleteCommand(root, "/about", { confirm: true });

      let fileGone = false;
      try { await Deno.stat(join(root, "content", "about.md")); }
      catch { fileGone = true; }
      assertEquals(fileGone, true, "Flat .md file should be deleted");
    });
  },
);

// ---------------------------------------------------------------------------
// Route normalisation & prefix stripping
// ---------------------------------------------------------------------------

Deno.test(
  "content:delete normalizes route without leading slash",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withTempSite(async (root) => {
      await createFolderPage(root, "about");

      // Pass "about" without leading slash
      await contentDeleteCommand(root, "about", { confirm: true });

      let fileGone = false;
      try { await Deno.stat(join(root, "content", "about", "default.md")); }
      catch { fileGone = true; }
      assertEquals(fileGone, true);
    });
  },
);

Deno.test(
  "content:delete handles numeric prefix folder correctly",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withTempSite(async (root) => {
      await createFolderPage(root, "03.services");

      await contentDeleteCommand(root, "/services", { confirm: true });

      let fileGone = false;
      try { await Deno.stat(join(root, "content", "03.services", "default.md")); }
      catch { fileGone = true; }
      assertEquals(fileGone, true, "Numeric-prefix folder page should be deleted");
    });
  },
);

// ---------------------------------------------------------------------------
// Error: unknown route
// ---------------------------------------------------------------------------

Deno.test(
  "content:delete exits 1 for unknown route",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withTempSite(async (root) => {
      const origExit = Deno.exit;
      let exitCode: number | undefined;
      Deno.exit = (code?: number) => {
        exitCode = code;
        throw new Error(`exit:${code}`);
      };

      try {
        await contentDeleteCommand(root, "/nonexistent", { dryRun: true });
      } catch { /* expected */ } finally {
        Deno.exit = origExit;
      }

      assertEquals(exitCode, 1);
    });
  },
);
