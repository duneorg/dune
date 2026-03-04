/**
 * Tests for config loader — deep merge, environment detection, config loading.
 */

import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { deepMerge, detectEnvironment, loadConfig } from "../../src/config/loader.ts";
import { DEFAULT_CONFIG } from "../../src/config/defaults.ts";
import type { StorageAdapter, StorageEntry, StorageStat, WatchEvent } from "../../src/storage/types.ts";

// === Test Helpers ===

/** In-memory storage adapter for testing */
class MemoryStorage implements StorageAdapter {
  private files = new Map<string, string>();

  constructor(files?: Record<string, string>) {
    if (files) {
      for (const [path, content] of Object.entries(files)) {
        this.files.set(path, content);
      }
    }
  }

  async read(path: string): Promise<Uint8Array> {
    const text = this.files.get(path);
    if (!text) throw new Error(`Not found: ${path}`);
    return new TextEncoder().encode(text);
  }

  async readText(path: string): Promise<string> {
    const text = this.files.get(path);
    if (!text) throw new Error(`Not found: ${path}`);
    return text;
  }

  async write(path: string, data: Uint8Array | string): Promise<void> {
    this.files.set(path, typeof data === "string" ? data : new TextDecoder().decode(data));
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async delete(path: string): Promise<void> {
    this.files.delete(path);
  }

  async rename(_oldPath: string, _newPath: string): Promise<void> {
    return Promise.resolve();
  }

  async list(path: string): Promise<StorageEntry[]> {
    return [];
  }

  async listRecursive(path: string): Promise<StorageEntry[]> {
    return [];
  }

  async stat(path: string): Promise<StorageStat> {
    return { size: 0, mtime: Date.now(), isFile: true, isDirectory: false };
  }

  async getJSON<T>(key: string): Promise<T | null> {
    return null;
  }

  async setJSON<T>(key: string, value: T, ttl?: number): Promise<void> {}

  async deleteJSON(key: string): Promise<void> {}

  watch(path: string, callback: (event: WatchEvent) => void): () => void {
    return () => {};
  }
}

// === deepMerge tests ===

Deno.test("deepMerge: shallow properties", () => {
  const base = { a: 1, b: 2 };
  const override = { b: 3, c: 4 };
  const result = deepMerge(base, override);
  assertEquals(result, { a: 1, b: 3, c: 4 } as Record<string, unknown>);
});

Deno.test("deepMerge: nested objects merged recursively", () => {
  const base = { site: { title: "Old", description: "Desc" } };
  const override = { site: { title: "New" } };
  const result = deepMerge(base, override);
  assertEquals(result, { site: { title: "New", description: "Desc" } });
});

Deno.test("deepMerge: arrays are replaced, not concatenated", () => {
  const base = { tags: ["a", "b"] };
  const override = { tags: ["c"] };
  const result = deepMerge(base, override);
  assertEquals(result, { tags: ["c"] });
});

Deno.test("deepMerge: null values override", () => {
  const base = { a: { b: 1 } };
  const override = { a: null };
  const result = deepMerge(base, override as Record<string, unknown>);
  assertEquals(result.a, null);
});

Deno.test("deepMerge: does not mutate base", () => {
  const base = { site: { title: "Old" } };
  const override = { site: { title: "New" } };
  deepMerge(base, override);
  assertEquals(base.site.title, "Old");
});

// === detectEnvironment tests ===

Deno.test("detectEnvironment: defaults to development", () => {
  // Store originals
  const origDune = Deno.env.get("DUNE_ENV");
  const origDeploy = Deno.env.get("DENO_DEPLOYMENT_ID");

  try {
    Deno.env.delete("DUNE_ENV");
    Deno.env.delete("DENO_DEPLOYMENT_ID");
    assertEquals(detectEnvironment(), "development");
  } finally {
    // Restore
    if (origDune) Deno.env.set("DUNE_ENV", origDune);
    if (origDeploy) Deno.env.set("DENO_DEPLOYMENT_ID", origDeploy);
  }
});

Deno.test("detectEnvironment: respects DUNE_ENV", () => {
  const orig = Deno.env.get("DUNE_ENV");
  try {
    Deno.env.set("DUNE_ENV", "staging");
    assertEquals(detectEnvironment(), "staging");
  } finally {
    if (orig) Deno.env.set("DUNE_ENV", orig);
    else Deno.env.delete("DUNE_ENV");
  }
});

// === loadConfig tests ===

Deno.test("loadConfig: returns defaults when no config files exist", async () => {
  const storage = new MemoryStorage();
  const config = await loadConfig({
    storage,
    rootDir: "/tmp/test",
    skipConfigTs: true,
    skipValidation: true,
  });
  assertEquals(config.site.title, "Dune Site");
  assertEquals(config.system.cache.driver, "filesystem");
  assertEquals(config.theme.name, "default");
});

Deno.test("loadConfig: merges site.yaml into site config", async () => {
  const storage = new MemoryStorage({
    "config/site.yaml": `title: "My Site"\ndescription: "My awesome site"`,
  });
  const config = await loadConfig({
    storage,
    rootDir: "/tmp/test",
    skipConfigTs: true,
    skipValidation: true,
  });
  assertEquals(config.site.title, "My Site");
  assertEquals(config.site.description, "My awesome site");
  // Non-overridden values should remain as defaults
  assertEquals(config.site.url, "http://localhost:8000");
});

Deno.test("loadConfig: merges system.yaml into system config", async () => {
  const storage = new MemoryStorage({
    "config/system.yaml": `debug: true\ncache:\n  enabled: false`,
  });
  const config = await loadConfig({
    storage,
    rootDir: "/tmp/test",
    skipConfigTs: true,
    skipValidation: true,
  });
  assertEquals(config.system.debug, true);
  assertEquals(config.system.cache.enabled, false);
  // Non-overridden cache values should remain
  assertEquals(config.system.cache.driver, "filesystem");
});

Deno.test("loadConfig: environment-specific overrides", async () => {
  const storage = new MemoryStorage({
    "config/system.yaml": `debug: false`,
    "config/env/development/system.yaml": `debug: true`,
  });
  const config = await loadConfig({
    storage,
    rootDir: "/tmp/test",
    env: "development",
    skipConfigTs: true,
    skipValidation: true,
  });
  assertEquals(config.system.debug, true);
});

Deno.test("loadConfig: validation catches invalid config", async () => {
  const storage = new MemoryStorage({
    "config/site.yaml": `title: ""`,
  });
  await assertRejects(
    () =>
      loadConfig({
        storage,
        rootDir: "/tmp/test",
        skipConfigTs: true,
        skipValidation: false,
      }),
    Error,
    "Invalid configuration",
  );
});
