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
