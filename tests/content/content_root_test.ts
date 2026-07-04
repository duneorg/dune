/**
 * Tests for content root resolution (content.src, mirroring theme.src).
 */

import {
  assertEquals,
  assertRejects,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { FileSystemAdapter } from "../../src/storage/fs.ts";
import {
  createContentStorage,
  resolveContentDirPath,
} from "../../src/content/content-root.ts";

const SITE_DIR = join(Deno.cwd(), ".dune-test-content-root-site");
const EXTERNAL_DIR = join(Deno.cwd(), ".dune-test-content-root-external");

async function teardown(): Promise<void> {
  for (const dir of [SITE_DIR, EXTERNAL_DIR]) {
    try {
      await Deno.remove(dir, { recursive: true });
    } catch {
      // ignore
    }
  }
}

// === resolveContentDirPath ===

Deno.test("resolveContentDirPath: unset src joins dir under site root", () => {
  const result = resolveContentDirPath({ dir: "content" }, "/site");
  assertEquals(result, "/site/content");
});

Deno.test("resolveContentDirPath: relative src resolves against site root", () => {
  const result = resolveContentDirPath(
    { dir: "content", src: "../shared/blog" },
    "/a/b/site",
  );
  assertEquals(result, "/a/b/shared/blog");
});

Deno.test("resolveContentDirPath: absolute src is used as-is", () => {
  const result = resolveContentDirPath(
    { dir: "content", src: "/mnt/shared/blog" },
    "/a/b/site",
  );
  assertEquals(result, "/mnt/shared/blog");
});

// === createContentStorage ===

Deno.test("createContentStorage: unset src is a passthrough to site storage", () => {
  const siteStorage = new FileSystemAdapter("/site");
  const result = createContentStorage({ dir: "content" }, "/site", siteStorage);
  assertStrictEquals(result.storage, siteStorage);
  assertEquals(result.contentDir, "content");
});

Deno.test("createContentStorage: src set returns a separate storage rooted at the external path, contentDir '.'", async () => {
  try {
    await ensureDir(join(EXTERNAL_DIR, "01.home"));
    await Deno.writeTextFile(join(EXTERNAL_DIR, "01.home", "default.md"), "---\ntitle: Home\n---\n");

    const siteStorage = new FileSystemAdapter(SITE_DIR);
    const { storage, contentDir } = createContentStorage(
      { dir: "content", src: EXTERNAL_DIR },
      SITE_DIR,
      siteStorage,
    );

    assertEquals(contentDir, ".");
    // Distinct from the site's own storage — a real external mount.
    const entries = await storage.listRecursive(contentDir);
    const paths = entries.map((e) => e.path).sort();
    assertEquals(paths, ["01.home", "01.home/default.md"]);

    const text = await storage.readText(join("01.home", "default.md"));
    assertEquals(text, "---\ntitle: Home\n---\n");
  } finally {
    await teardown();
  }
});

Deno.test("createContentStorage: src storage still enforces its own containment boundary", async () => {
  try {
    await ensureDir(EXTERNAL_DIR);
    const siteStorage = new FileSystemAdapter(SITE_DIR);
    const { storage } = createContentStorage(
      { dir: "content", src: EXTERNAL_DIR },
      SITE_DIR,
      siteStorage,
    );

    // Traversal out of the external content root is still refused —
    // content.src relocates the boundary, it never widens it.
    await assertRejects(
      () => storage.readText("../etc/passwd"),
      Error,
      "Path escapes storage root",
    );
    await assertRejects(
      () => storage.readText("/etc/passwd"),
      Error,
      "Path escapes storage root",
    );
  } finally {
    await teardown();
  }
});
