/**
 * Tests for config loader — deep merge, environment detection, config loading.
 */

import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { deepMerge, detectEnvironment, loadConfig } from "../../src/config/loader.ts";
import { DEFAULT_CONFIG } from "../../src/config/defaults.ts";
import type {
  StorageAdapter,
  StorageEntry,
  StorageStat,
  WatchEvent,
} from "../../src/storage/types.ts";

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
  assertEquals(config.system.images.default_quality, 80);
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
    "config/system.yaml": `debug: true\nimages:\n  default_quality: 55`,
  });
  const config = await loadConfig({
    storage,
    rootDir: "/tmp/test",
    skipConfigTs: true,
    skipValidation: true,
  });
  assertEquals(config.system.debug, true);
  assertEquals(config.system.images.default_quality, 55);
  // Non-overridden values in the same section should remain
  assertEquals(config.system.images.cache_dir, ".dune/cache/images");
});

Deno.test("loadConfig: a system.yaml `admin:` block is refused and says where the settings went", async () => {
  const storage = new MemoryStorage({
    "config/system.yaml": `admin:\n  max_upload_mb: 7\ndebug: true`,
  });
  await assertRejects(
    () => loadConfig({ storage, rootDir: "/tmp/test", skipConfigTs: true, skipValidation: true }),
    Error,
    "plugins:",
  );
});

Deno.test("loadConfig: there is no DuneConfig.admin and no default admin settings", async () => {
  const config = await loadConfig({
    storage: new MemoryStorage({ "config/system.yaml": `debug: true` }),
    rootDir: "/tmp/test",
    skipConfigTs: true,
    skipValidation: true,
  });
  assertEquals((config as unknown as Record<string, unknown>).admin, undefined);
  assertEquals((config.system as unknown as Record<string, unknown>).admin, undefined);
  assertEquals(config.system.debug, true);
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

Deno.test("deepMerge: an override of role_grants replaces the mapping instead of merging into it", () => {
  const base: { system: { role_grants: Record<string, string>; debug: boolean } } = {
    system: { role_grants: { staff: "editor", editor: "author" }, debug: false },
  };
  assertEquals(deepMerge(base, { system: { role_grants: {} } }).system.role_grants, {});
  assertEquals(deepMerge(base, { system: { role_grants: { boss: "admin" } } }).system.role_grants, {
    boss: "admin",
  });
  // Other nested objects still merge key by key.
  assertEquals(deepMerge(base, { system: { debug: true } }).system, {
    role_grants: { staff: "editor", editor: "author" },
    debug: true,
  });
});

Deno.test("loadConfig: dune.config.ts with a renamed (camelCase) key is refused like the YAML files", async () => {
  const dir = await Deno.makeTempDir({ dir: Deno.cwd(), prefix: ".cfg-ts-" });
  try {
    await Deno.writeTextFile(
      `${dir}/dune.config.ts`,
      `export default { system: { content: { allowTsxFormat: true } } };\n`,
    );
    await assertRejects(
      () => loadConfig({ storage: new MemoryStorage(), rootDir: dir, skipValidation: true }),
      Error,
      "allowTsxFormat",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("loadConfig: dune.config.ts with a top-level admin block is refused: core has no admin config any more", async () => {
  const dir = await Deno.makeTempDir({ dir: Deno.cwd(), prefix: ".cfg-ts-" });
  try {
    await Deno.writeTextFile(
      `${dir}/dune.config.ts`,
      `export default { admin: { session_lifetime: 60 } };\n`,
    );
    await assertRejects(
      () => loadConfig({ storage: new MemoryStorage(), rootDir: dir, skipValidation: true }),
      Error,
      "admin",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("loadConfig: dune.config.ts with current keys still loads", async () => {
  const dir = await Deno.makeTempDir({ dir: Deno.cwd(), prefix: ".cfg-ts-" });
  try {
    await Deno.writeTextFile(
      `${dir}/dune.config.ts`,
      `export default { site: { title: "From TS" }, system: { content: { allow_tsx_format: true } } };\n`,
    );
    const config = await loadConfig({
      storage: new MemoryStorage(),
      rootDir: dir,
      skipValidation: true,
    });
    assertEquals(config.site.title, "From TS");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
