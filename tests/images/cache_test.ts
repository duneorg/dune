/**
 * Tests for the image cache.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createImageCache } from "../../src/images/cache.ts";

/**
 * In-memory storage adapter for testing (same pattern as other test files).
 */
function createMemoryStorage() {
  const files = new Map<string, Uint8Array>();

  return {
    async read(path: string): Promise<Uint8Array> {
      const data = files.get(path);
      if (!data) throw new Error(`Not found: ${path}`);
      return data;
    },
    async write(path: string, data: Uint8Array): Promise<void> {
      files.set(path, data);
    },
    async exists(path: string): Promise<boolean> {
      return files.has(path);
    },
    async delete(path: string): Promise<void> {
      files.delete(path);
    },
    async list(dir: string): Promise<{ name: string; isDirectory: boolean }[]> {
      const entries: { name: string; isDirectory: boolean }[] = [];
      const prefix = dir.endsWith("/") ? dir : dir + "/";
      for (const key of files.keys()) {
        if (key.startsWith(prefix)) {
          const rest = key.slice(prefix.length);
          if (!rest.includes("/")) {
            entries.push({ name: rest, isDirectory: false });
          }
        }
      }
      return entries;
    },
    async stat(path: string): Promise<{ size: number; mtime: number; isFile: boolean; isDirectory: boolean }> {
      const data = files.get(path);
      if (!data) throw new Error(`Not found: ${path}`);
      return { size: data.length, mtime: Date.now(), isFile: true, isDirectory: false };
    },
    // Expose internals for testing
    _files: files,
  } as any;
}

// === buildKey ===

Deno.test("ImageCache: buildKey produces deterministic keys", async () => {
  const storage = createMemoryStorage();
  const cache = createImageCache({ storage, cacheDir: ".dune/cache/images" });

  const key1 = await cache.buildKey("img/photo.jpg", { width: 640, format: "webp" });
  const key2 = await cache.buildKey("img/photo.jpg", { width: 640, format: "webp" });

  assertEquals(key1, key2);
  assertEquals(key1.length, 16); // 16 hex chars
});

Deno.test("ImageCache: buildKey differs for different options", async () => {
  const storage = createMemoryStorage();
  const cache = createImageCache({ storage, cacheDir: ".dune/cache/images" });

  const key1 = await cache.buildKey("img/photo.jpg", { width: 640 });
  const key2 = await cache.buildKey("img/photo.jpg", { width: 320 });

  assertEquals(key1 !== key2, true);
});

Deno.test("ImageCache: buildKey differs for different paths", async () => {
  const storage = createMemoryStorage();
  const cache = createImageCache({ storage, cacheDir: ".dune/cache/images" });

  const key1 = await cache.buildKey("img/photo.jpg", { width: 640 });
  const key2 = await cache.buildKey("img/other.jpg", { width: 640 });

  assertEquals(key1 !== key2, true);
});

Deno.test("ImageCache: buildKey ignores option key order", async () => {
  const storage = createMemoryStorage();
  const cache = createImageCache({ storage, cacheDir: ".dune/cache/images" });

  const key1 = await cache.buildKey("img/photo.jpg", { width: 640, format: "webp" });
  const key2 = await cache.buildKey("img/photo.jpg", { format: "webp", width: 640 });

  assertEquals(key1, key2);
});

// === get / set ===

Deno.test("ImageCache: get returns null for missing key", async () => {
  const storage = createMemoryStorage();
  const cache = createImageCache({ storage, cacheDir: ".dune/cache/images" });

  const result = await cache.get("nonexistent");
  assertEquals(result, null);
});

Deno.test("ImageCache: set then get round-trip", async () => {
  const storage = createMemoryStorage();
  const cache = createImageCache({ storage, cacheDir: ".dune/cache/images" });

  const imageData = new Uint8Array([1, 2, 3, 4, 5]);
  await cache.set("testkey", {
    data: imageData,
    contentType: "image/webp",
    width: 640,
    height: 480,
  });

  const result = await cache.get("testkey");
  assertEquals(result !== null, true);
  assertEquals(result!.contentType, "image/webp");
  assertEquals(result!.width, 640);
  assertEquals(result!.height, 480);
  assertEquals(result!.data.length, 5);
});

Deno.test("ImageCache: set stores both data and meta files", async () => {
  const storage = createMemoryStorage();
  const cache = createImageCache({ storage, cacheDir: ".cache" });

  await cache.set("abc", {
    data: new Uint8Array([10, 20]),
    contentType: "image/jpeg",
    width: 100,
    height: 50,
  });

  assertEquals(await storage.exists(".cache/abc.bin"), true);
  assertEquals(await storage.exists(".cache/abc.meta.json"), true);
});

// === has ===

Deno.test("ImageCache: has returns false for missing key", async () => {
  const storage = createMemoryStorage();
  const cache = createImageCache({ storage, cacheDir: ".cache" });

  assertEquals(await cache.has("nope"), false);
});

Deno.test("ImageCache: has returns true after set", async () => {
  const storage = createMemoryStorage();
  const cache = createImageCache({ storage, cacheDir: ".cache" });

  await cache.set("exists", {
    data: new Uint8Array([1]),
    contentType: "image/png",
    width: 10,
    height: 10,
  });

  assertEquals(await cache.has("exists"), true);
});

// === clear ===

Deno.test("ImageCache: clear removes all cached entries", async () => {
  const storage = createMemoryStorage();
  const cache = createImageCache({ storage, cacheDir: ".cache" });

  await cache.set("a", {
    data: new Uint8Array([1]),
    contentType: "image/png",
    width: 10,
    height: 10,
  });

  await cache.set("b", {
    data: new Uint8Array([2]),
    contentType: "image/jpeg",
    width: 20,
    height: 20,
  });

  assertEquals(await cache.has("a"), true);
  assertEquals(await cache.has("b"), true);

  await cache.clear();

  assertEquals(await cache.has("a"), false);
  assertEquals(await cache.has("b"), false);
});

Deno.test("ImageCache: clear on empty cache does not throw", async () => {
  const storage = createMemoryStorage();
  const cache = createImageCache({ storage, cacheDir: ".cache" });

  // Should not throw
  await cache.clear();
});
