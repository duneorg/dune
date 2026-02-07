/**
 * Tests for the image HTTP handler.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createImageHandler } from "../../src/images/handler.ts";
import { createImageProcessor } from "../../src/images/processor.ts";
import { createImageCache } from "../../src/images/cache.ts";

const DEFAULT_CONFIG = {
  defaultQuality: 80,
  allowedSizes: [320, 640, 768, 1024, 1280, 1536, 1920],
};

/** Create a test JPEG image via Sharp. */
async function createTestJpeg(width = 200, height = 150): Promise<Uint8Array> {
  const sharp = (await import("sharp")).default;
  const buf = await sharp({
    create: { width, height, channels: 3, background: { r: 100, g: 150, b: 200 } },
  }).jpeg().toBuffer();
  return new Uint8Array(buf);
}

/** In-memory storage for cache tests. */
function createMemoryStorage() {
  const files = new Map<string, Uint8Array>();
  return {
    async read(path: string) {
      const d = files.get(path);
      if (!d) throw new Error(`Not found: ${path}`);
      return d;
    },
    async write(path: string, data: Uint8Array) { files.set(path, data); },
    async exists(path: string) { return files.has(path); },
    async delete(path: string) { files.delete(path); },
    async list(dir: string) {
      const entries: { name: string; isDirectory: boolean }[] = [];
      const prefix = dir.endsWith("/") ? dir : dir + "/";
      for (const key of files.keys()) {
        if (key.startsWith(prefix)) {
          const rest = key.slice(prefix.length);
          if (!rest.includes("/")) entries.push({ name: rest, isDirectory: false });
        }
      }
      return entries;
    },
    async stat(path: string) {
      const d = files.get(path);
      if (!d) throw new Error(`Not found: ${path}`);
      return { size: d.length, mtime: Date.now(), isFile: true, isDirectory: false };
    },
  } as any;
}

/** Create mock engine with a single test image. */
function createMockEngine(mediaMap: Record<string, Uint8Array> = {}) {
  return {
    serveMedia: async (path: string) => {
      const data = mediaMap[path];
      if (!data) return null;
      const ext = path.split(".").pop()?.toLowerCase() ?? "";
      const mimeMap: Record<string, string> = {
        jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
        webp: "image/webp", gif: "image/gif",
      };
      return { data, contentType: mimeMap[ext] ?? "application/octet-stream", size: data.length };
    },
  } as any;
}

function createTestHandler(
  mediaMap: Record<string, Uint8Array> = {},
) {
  const storage = createMemoryStorage();
  const processor = createImageProcessor(DEFAULT_CONFIG);
  const cache = createImageCache({ storage, cacheDir: ".cache" });
  const engine = createMockEngine(mediaMap);
  const handler = createImageHandler({ engine, processor, cache });
  return { handler, cache, storage };
}

// === Passthrough (no params) ===

Deno.test("ImageHandler: returns null for non-media paths", async () => {
  const { handler } = createTestHandler();
  const req = new Request("http://localhost/api/pages");
  const result = await handler(req);
  assertEquals(result, null);
});

Deno.test("ImageHandler: returns null when no image params", async () => {
  const { handler } = createTestHandler();
  const req = new Request("http://localhost/content-media/img/photo.jpg");
  const result = await handler(req);
  assertEquals(result, null);
});

Deno.test("ImageHandler: returns null for non-image files with params", async () => {
  const { handler } = createTestHandler();
  const req = new Request("http://localhost/content-media/doc/file.pdf?width=640");
  const result = await handler(req);
  assertEquals(result, null);
});

// === Image processing ===

Deno.test("ImageHandler: processes image with width param", async () => {
  const testImage = await createTestJpeg(1920, 1080);
  const { handler } = createTestHandler({ "img/photo.jpg": testImage });

  const req = new Request("http://localhost/content-media/img/photo.jpg?width=640");
  const result = await handler(req);

  assertEquals(result !== null, true);
  assertEquals(result!.status, 200);
  assertEquals(result!.headers.get("Content-Type"), "image/jpeg");
  assertEquals(result!.headers.get("X-Dune-Image"), "processed");
  assertEquals(result!.headers.get("X-Dune-Image-Width"), "640");
});

Deno.test("ImageHandler: processes with format conversion", async () => {
  const testImage = await createTestJpeg(1920, 1080);
  const { handler } = createTestHandler({ "img/photo.jpg": testImage });

  const req = new Request("http://localhost/content-media/img/photo.jpg?width=640&format=webp");
  const result = await handler(req);

  assertEquals(result !== null, true);
  assertEquals(result!.headers.get("Content-Type"), "image/webp");
});

Deno.test("ImageHandler: returns 400 for disallowed size", async () => {
  const testImage = await createTestJpeg(1920, 1080);
  const { handler } = createTestHandler({ "img/photo.jpg": testImage });

  const req = new Request("http://localhost/content-media/img/photo.jpg?width=500");
  const result = await handler(req);

  assertEquals(result !== null, true);
  assertEquals(result!.status, 400);
});

Deno.test("ImageHandler: returns 404 for missing image", async () => {
  const { handler } = createTestHandler();

  const req = new Request("http://localhost/content-media/img/missing.jpg?width=640");
  const result = await handler(req);

  assertEquals(result !== null, true);
  assertEquals(result!.status, 404);
});

// === Caching ===

Deno.test("ImageHandler: caches processed images", async () => {
  const testImage = await createTestJpeg(1920, 1080);
  const { handler } = createTestHandler({ "img/photo.jpg": testImage });

  // First request — cache miss → "processed"
  const req1 = new Request("http://localhost/content-media/img/photo.jpg?width=640");
  const res1 = await handler(req1);
  assertEquals(res1!.headers.get("X-Dune-Image"), "processed");

  // Wait a tick for fire-and-forget cache write to complete
  await new Promise((r) => setTimeout(r, 50));

  // Second request — cache hit
  const req2 = new Request("http://localhost/content-media/img/photo.jpg?width=640");
  const res2 = await handler(req2);
  assertEquals(res2!.headers.get("X-Dune-Image"), "cache-hit");
});

Deno.test("ImageHandler: sets immutable Cache-Control", async () => {
  const testImage = await createTestJpeg(1920, 1080);
  const { handler } = createTestHandler({ "img/photo.jpg": testImage });

  const req = new Request("http://localhost/content-media/img/photo.jpg?width=640");
  const result = await handler(req);

  assertEquals(
    result!.headers.get("Cache-Control"),
    "public, max-age=31536000, immutable",
  );
});

// === Short param aliases ===

Deno.test("ImageHandler: supports short param aliases (w, h, q, f)", async () => {
  const testImage = await createTestJpeg(1920, 1080);
  const { handler } = createTestHandler({ "img/photo.jpg": testImage });

  const req = new Request("http://localhost/content-media/img/photo.jpg?w=640&f=webp");
  const result = await handler(req);

  assertEquals(result !== null, true);
  assertEquals(result!.headers.get("Content-Type"), "image/webp");
  assertEquals(result!.headers.get("X-Dune-Image-Width"), "640");
});
