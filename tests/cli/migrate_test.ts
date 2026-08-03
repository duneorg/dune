/**
 * Tests for `dune migrate:from-*`'s `onPageCreate` hook firing (v0.31.6).
 *
 * Bulk import commands stay headless (no hook registry, no plugin loading)
 * by default — only `--fire-hooks` opts in, unlike `dune content:create`
 * which fires unconditionally (see content_create_test.ts). This file only
 * covers that hook-firing behavior; migrateFromMarkdown's own import logic
 * has no other test coverage yet.
 */

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { join } from "@std/path";
import { migrateFromMarkdown } from "../../src/cli/migrate.ts";

async function withTempSite(fn: (root: string) => Promise<void>): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "dune_test_migrate_" });
  try {
    await fn(root);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

async function setupPluginSite(root: string): Promise<void> {
  await Deno.mkdir(join(root, "config"), { recursive: true });
  await Deno.writeTextFile(
    join(root, "config", "site.yaml"),
    "plugins:\n  - src: ./plugins/test-plugin.ts\n",
  );
  await Deno.mkdir(join(root, "plugins"), { recursive: true });
  await Deno.writeTextFile(
    join(root, "plugins", "test-plugin.ts"),
    `let count = 0;
    export default {
      name: "test-plugin",
      version: "1.0.0",
      hooks: {
        async onPageCreate(ctx) {
          count++;
          await Deno.writeTextFile(
            new URL("../.hook-fired.json", import.meta.url).pathname,
            JSON.stringify({ count, last: ctx.data }),
          );
        },
      },
    };\n`,
  );
}

async function setupSourceDir(root: string): Promise<string> {
  const src = join(root, "src");
  await Deno.mkdir(src, { recursive: true });
  await Deno.writeTextFile(join(src, "hello.md"), "---\ntitle: Hello\n---\n\n# Hello\n");
  return src;
}

Deno.test("migrate:from-markdown: does not fire hooks by default", async () => {
  await withTempSite(async (root) => {
    await setupPluginSite(root);
    const src = await setupSourceDir(root);

    await migrateFromMarkdown(src, root, {});

    const markerExists = await Deno.stat(join(root, ".hook-fired.json"))
      .then(() => true)
      .catch(() => false);
    assertEquals(markerExists, false, "onPageCreate must not fire without --fire-hooks");
  });
});

Deno.test("migrate:from-markdown: fires onPageCreate per page with --fire-hooks", async () => {
  await withTempSite(async (root) => {
    await setupPluginSite(root);
    const src = await setupSourceDir(root);

    await migrateFromMarkdown(src, root, { fireHooks: true });

    const marker = JSON.parse(await Deno.readTextFile(join(root, ".hook-fired.json")));
    assertEquals(marker.count, 1);
    assertEquals(marker.last.title, "Hello");
    assertStringIncludes(marker.last.sourcePath, "hello");
  });
});

Deno.test("migrate:from-markdown: --dry-run never fires hooks even with --fire-hooks", async () => {
  await withTempSite(async (root) => {
    await setupPluginSite(root);
    const src = await setupSourceDir(root);

    await migrateFromMarkdown(src, root, { fireHooks: true, dryRun: true });

    const markerExists = await Deno.stat(join(root, ".hook-fired.json"))
      .then(() => true)
      .catch(() => false);
    assertEquals(markerExists, false, "dry-run must not fire hooks — nothing was created");
  });
});
