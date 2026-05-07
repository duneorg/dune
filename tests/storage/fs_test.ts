/**
 * Tests for the FileSystem storage adapter.
 */

import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { FileSystemAdapter } from "../../src/storage/fs.ts";

const TEST_DIR = join(Deno.cwd(), ".dune-test-storage");

/** Create a clean test directory before each test suite */
async function setup(): Promise<FileSystemAdapter> {
  await ensureDir(TEST_DIR);
  return new FileSystemAdapter(TEST_DIR);
}

/** Clean up test directory */
async function teardown(): Promise<void> {
  try {
    await Deno.remove(TEST_DIR, { recursive: true });
  } catch {
    // Ignore cleanup errors
  }
}

// === File operations ===

Deno.test("FileSystemAdapter: write and read text", async () => {
  const fs = await setup();
  try {
    await fs.write("test.txt", "Hello, Dune!");
    const content = await fs.readText("test.txt");
    assertEquals(content, "Hello, Dune!");
  } finally {
    await teardown();
  }
});

Deno.test("FileSystemAdapter: write and read binary", async () => {
  const fs = await setup();
  try {
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    await fs.write("test.bin", data);
    const result = await fs.read("test.bin");
    assertEquals(result, data);
  } finally {
    await teardown();
  }
});

Deno.test("FileSystemAdapter: write creates parent directories", async () => {
  const fs = await setup();
  try {
    await fs.write("a/b/c/test.txt", "deep file");
    const content = await fs.readText("a/b/c/test.txt");
    assertEquals(content, "deep file");
  } finally {
    await teardown();
  }
});

Deno.test("FileSystemAdapter: read non-existent file throws StorageError", async () => {
  const fs = await setup();
  try {
    await assertRejects(
      () => fs.readText("nonexistent.txt"),
      Error,
      "File not found",
    );
  } finally {
    await teardown();
  }
});

// === Path containment (MED-21, CWE-22) ===

Deno.test("FileSystemAdapter: read refuses parent traversal segments", async () => {
  const fs = await setup();
  try {
    await assertRejects(
      () => fs.readText("../etc/passwd"),
      Error,
      "Path escapes storage root",
    );
  } finally {
    await teardown();
  }
});

Deno.test("FileSystemAdapter: write refuses absolute paths", async () => {
  const fs = await setup();
  try {
    await assertRejects(
      () => fs.write("/etc/evil.txt", "no"),
      Error,
      "Path escapes storage root",
    );
  } finally {
    await teardown();
  }
});

Deno.test("FileSystemAdapter: refuses NUL injection", async () => {
  const fs = await setup();
  try {
    await assertRejects(
      () => fs.write("ok.txt\0/../escape", "no"),
      Error,
      "Path escapes storage root",
    );
  } finally {
    await teardown();
  }
});

Deno.test("FileSystemAdapter: rename refuses traversal in either side", async () => {
  const fs = await setup();
  try {
    await fs.write("ok.txt", "ok");
    await assertRejects(
      () => fs.rename("ok.txt", "../escaped.txt"),
      Error,
      "Path escapes storage root",
    );
  } finally {
    await teardown();
  }
});

// === Existence check ===

Deno.test("FileSystemAdapter: exists returns true for existing file", async () => {
  const fs = await setup();
  try {
    await fs.write("exists.txt", "yes");
    assertEquals(await fs.exists("exists.txt"), true);
  } finally {
    await teardown();
  }
});

Deno.test("FileSystemAdapter: exists returns false for missing file", async () => {
  const fs = await setup();
  try {
    assertEquals(await fs.exists("missing.txt"), false);
  } finally {
    await teardown();
  }
});

// === Delete ===

Deno.test("FileSystemAdapter: delete removes file", async () => {
  const fs = await setup();
  try {
    await fs.write("to-delete.txt", "bye");
    await fs.delete("to-delete.txt");
    assertEquals(await fs.exists("to-delete.txt"), false);
  } finally {
    await teardown();
  }
});

Deno.test("FileSystemAdapter: delete non-existent file does not throw", async () => {
  const fs = await setup();
  try {
    await fs.delete("nonexistent.txt"); // Should not throw
  } finally {
    await teardown();
  }
});

// === Directory listing ===

Deno.test("FileSystemAdapter: list returns sorted entries", async () => {
  const fs = await setup();
  try {
    await fs.write("c.txt", "c");
    await fs.write("a.txt", "a");
    await fs.write("b.txt", "b");

    const entries = await fs.list(".");
    const names = entries.map((e) => e.name);
    assertEquals(names, ["a.txt", "b.txt", "c.txt"]);
    assertEquals(entries[0].isFile, true);
  } finally {
    await teardown();
  }
});

Deno.test("FileSystemAdapter: listRecursive walks directories", async () => {
  const fs = await setup();
  try {
    await fs.write("top.txt", "top");
    await fs.write("sub/nested.txt", "nested");
    await fs.write("sub/deep/file.txt", "deep");

    const entries = await fs.listRecursive(".");
    const names = entries.filter((e) => e.isFile).map((e) => e.name);
    assertEquals(names.includes("top.txt"), true);
    assertEquals(names.includes("nested.txt"), true);
    assertEquals(names.includes("file.txt"), true);
  } finally {
    await teardown();
  }
});

// === Stat ===

Deno.test("FileSystemAdapter: stat returns file metadata", async () => {
  const fs = await setup();
  try {
    await fs.write("stat-test.txt", "hello world");
    const stat = await fs.stat("stat-test.txt");
    assertEquals(stat.isFile, true);
    assertEquals(stat.isDirectory, false);
    assertEquals(stat.size > 0, true);
    assertEquals(stat.mtime > 0, true);
  } finally {
    await teardown();
  }
});

// === JSON cache operations ===

Deno.test("FileSystemAdapter: setJSON and getJSON round-trip", async () => {
  const fs = await setup();
  try {
    await fs.setJSON("test-key", { foo: "bar", count: 42 });
    const result = await fs.getJSON<{ foo: string; count: number }>("test-key");
    assertEquals(result, { foo: "bar", count: 42 });
  } finally {
    await teardown();
  }
});

Deno.test("FileSystemAdapter: getJSON returns null for missing key", async () => {
  const fs = await setup();
  try {
    const result = await fs.getJSON("missing-key");
    assertEquals(result, null);
  } finally {
    await teardown();
  }
});

Deno.test("FileSystemAdapter: JSON TTL expiration", async () => {
  const fs = await setup();
  try {
    // Set with a very short TTL
    await fs.setJSON("expiring", { value: true }, 1);

    // Should still exist immediately
    const beforeExpiry = await fs.getJSON("expiring");
    assertEquals(beforeExpiry, { value: true });

    // Wait for TTL to expire (1 second + buffer)
    await new Promise((r) => setTimeout(r, 1100));

    const afterExpiry = await fs.getJSON("expiring");
    assertEquals(afterExpiry, null);
  } finally {
    await teardown();
  }
});

Deno.test("FileSystemAdapter: deleteJSON removes entry", async () => {
  const fs = await setup();
  try {
    await fs.setJSON("to-delete", { value: true });
    await fs.deleteJSON("to-delete");
    const result = await fs.getJSON("to-delete");
    assertEquals(result, null);
  } finally {
    await teardown();
  }
});
