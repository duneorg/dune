/**
 * Tests for MCP write tools — install_plugin pin enforcement.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildWriteTools } from "../../src/mcp/write-tools.ts";
import type { DuneEngine } from "../../src/core/engine.ts";
import type { StorageAdapter } from "../../src/storage/types.ts";

function makeStorage(): StorageAdapter & { writes: string[] } {
  const writes: string[] = [];
  return {
    writes,
    read: () => Promise.resolve(new TextEncoder().encode("title: Test\n")),
    write: (_path: string, data: Uint8Array) => {
      writes.push(new TextDecoder().decode(data));
      return Promise.resolve();
    },
  } as unknown as StorageAdapter & { writes: string[] };
}

Deno.test("install_plugin: rejects an unpinned jsr: specifier and does not write", async () => {
  const storage = makeStorage();
  const tools = buildWriteTools({
    engine: { pages: [] } as unknown as DuneEngine,
    storage,
    root: "/tmp",
    contentDir: "content",
  });
  const install = tools.find((t) => t.meta.name === "install_plugin");
  const result = await install!.handler({ src: "jsr:@dune/plugin-seo@^1.0.0" });
  assertEquals(result.isError, true);
  assertEquals((result.content[0] as { text: string }).text.includes("pinned"), true);
  assertEquals(storage.writes, []);
});

Deno.test("install_plugin: rejects https: without integrity", async () => {
  const storage = makeStorage();
  const tools = buildWriteTools({
    engine: { pages: [] } as unknown as DuneEngine,
    storage,
    root: "/tmp",
    contentDir: "content",
  });
  const install = tools.find((t) => t.meta.name === "install_plugin");
  const result = await install!.handler({ src: "https://example.com/plugin.ts" });
  assertEquals(result.isError, true);
  assertEquals((result.content[0] as { text: string }).text.includes("integrity"), true);
  assertEquals(storage.writes, []);
});

Deno.test("install_plugin: accepts a pinned jsr: specifier", async () => {
  const storage = makeStorage();
  const tools = buildWriteTools({
    engine: { pages: [] } as unknown as DuneEngine,
    storage,
    root: "/tmp",
    contentDir: "content",
  });
  const install = tools.find((t) => t.meta.name === "install_plugin");
  const result = await install!.handler({ src: "jsr:@dune/plugin-seo@1.0.0" });
  assertEquals(result.isError, undefined);
  assertEquals(storage.writes.length, 1);
  assertEquals(storage.writes[0].includes("jsr:@dune/plugin-seo@1.0.0"), true);
});

// ── write_page: frontmatter parse-and-warn ──────────────────────────────

function writePageTool(storage: StorageAdapter & { writes: string[] }) {
  const tools = buildWriteTools({
    engine: { pages: [] } as unknown as DuneEngine,
    storage,
    root: "/tmp",
    contentDir: "content",
  });
  return tools.find((t) => t.meta.name === "write_page")!;
}

Deno.test("write_page: valid frontmatter writes with no warning", async () => {
  const storage = makeStorage();
  const result = await writePageTool(storage).handler({
    path: "blog/hello.md",
    content: "---\ntitle: Hello\n---\n\nBody text\n",
  });
  assertEquals(result.isError, undefined);
  const text = (result.content[0] as { text: string }).text;
  assertEquals(text.includes("Written:"), true);
  assertEquals(text.includes("Warning"), false);
  assertEquals(storage.writes.length, 1);
});

Deno.test("write_page: malformed YAML frontmatter still writes, but with a warning", async () => {
  const storage = makeStorage();
  const result = await writePageTool(storage).handler({
    path: "blog/broken.md",
    // Unclosed bracket — invalid YAML.
    content: "---\ntitle: [Hello\n---\n\nBody text\n",
  });
  assertEquals(result.isError, undefined);
  const text = (result.content[0] as { text: string }).text;
  assertEquals(text.includes("Written:"), true);
  assertEquals(text.includes("Warning"), true);
  assertEquals(text.includes("not valid YAML"), true);
  // Still writes the content exactly as given — parse-and-warn, not reject.
  assertEquals(storage.writes.length, 1);
  assertEquals(storage.writes[0], "---\ntitle: [Hello\n---\n\nBody text\n");
});

Deno.test("write_page: no frontmatter block at all — no warning", async () => {
  const storage = makeStorage();
  const result = await writePageTool(storage).handler({
    path: "notes/plain.md",
    content: "Just a body, no frontmatter.\n",
  });
  assertEquals(result.isError, undefined);
  const text = (result.content[0] as { text: string }).text;
  assertEquals(text.includes("Warning"), false);
});

// ── update_frontmatter: malformed existing frontmatter ──────────────────

function updateFrontmatterTool(storage: StorageAdapter & { writes: string[] }) {
  const tools = buildWriteTools({
    engine: { pages: [] } as unknown as DuneEngine,
    storage,
    root: "/tmp",
    contentDir: "content",
  });
  return tools.find((t) => t.meta.name === "update_frontmatter")!;
}

function makeStorageWithContent(content: string): StorageAdapter & { writes: string[] } {
  const writes: string[] = [];
  return {
    writes,
    read: () => Promise.resolve(new TextEncoder().encode(content)),
    write: (_path: string, data: Uint8Array) => {
      writes.push(new TextDecoder().decode(data));
      return Promise.resolve();
    },
  } as unknown as StorageAdapter & { writes: string[] };
}

Deno.test("update_frontmatter: valid existing frontmatter merges correctly", async () => {
  const storage = makeStorageWithContent("---\ntitle: Hello\ndraft: true\n---\n\nBody text\n");
  const result = await updateFrontmatterTool(storage).handler({
    path: "blog/hello.md",
    updates: { draft: false, tags: ["a", "b"] },
  });
  assertEquals(result.isError, undefined);
  assertEquals(storage.writes.length, 1);
  const written = storage.writes[0];
  assertEquals(written.includes("title: Hello"), true);
  assertEquals(written.includes("draft: false"), true);
  assertEquals(written.includes("Body text"), true);
  // Only one frontmatter block should exist in the output.
  assertEquals(written.match(/^---/gm)?.length, 2);
});

Deno.test("update_frontmatter: malformed existing frontmatter errors instead of corrupting the file", async () => {
  // Unclosed bracket — invalid YAML, as written by write_page's parse-and-warn path.
  const storage = makeStorageWithContent("---\ntitle: [Hello\n---\n\nBody text\n");
  const result = await updateFrontmatterTool(storage).handler({
    path: "blog/broken.md",
    updates: { draft: false },
  });
  assertEquals(result.isError, true);
  const text = (result.content[0] as { text: string }).text;
  assertEquals(text.includes("malformed frontmatter"), true);
  // Must not write anything back — no duplicated/corrupted frontmatter.
  assertEquals(storage.writes, []);
});
