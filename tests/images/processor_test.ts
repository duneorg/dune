/**
 * Tests for the image processor.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createImageProcessor } from "../../src/images/processor.ts";

const DEFAULT_CONFIG = {
  defaultQuality: 80,
  allowedSizes: [320, 640, 768, 1024, 1280, 1536, 1920],
};

/** Create a small test JPEG image using Sharp. */
async function createTestImage(
  width = 200,
  height = 150,
  format: "jpeg" | "png" | "webp" = "jpeg",
): Promise<Uint8Array> {
  const sharp = (await import("sharp")).default;
  let pipeline = sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 100, g: 150, b: 200 },
    },
  });

  if (format === "jpeg") pipeline = pipeline.jpeg();
  else if (format === "png") pipeline = pipeline.png();
  else if (format === "webp") pipeline = pipeline.webp();

  const buf = await pipeline.toBuffer();
  return new Uint8Array(buf);
}

// === parseOptions ===

Deno.test("ImageProcessor: parseOptions returns null when no image params", () => {
  const proc = createImageProcessor(DEFAULT_CONFIG);
  const params = new URLSearchParams("foo=bar&baz=1");
  assertEquals(proc.parseOptions(params), null);
});

Deno.test("ImageProcessor: parseOptions parses width", () => {
  const proc = createImageProcessor(DEFAULT_CONFIG);
  const params = new URLSearchParams("width=640");
  const opts = proc.parseOptions(params);
  assertEquals(opts?.width, 640);
});

Deno.test("ImageProcessor: parseOptions parses short aliases", () => {
  const proc = createImageProcessor(DEFAULT_CONFIG);
  const params = new URLSearchParams("w=320&h=240&q=90&f=webp");
  const opts = proc.parseOptions(params);
  assertEquals(opts?.width, 320);
  assertEquals(opts?.height, 240);
  assertEquals(opts?.quality, 90);
  assertEquals(opts?.format, "webp");
});

Deno.test("ImageProcessor: parseOptions parses fit and focal", () => {
  const proc = createImageProcessor(DEFAULT_CONFIG);
  const params = new URLSearchParams("width=640&fit=contain&focal=50,30");
  const opts = proc.parseOptions(params);
  assertEquals(opts?.fit, "contain");
  assertEquals(opts?.focal, [50, 30]);
});

Deno.test("ImageProcessor: parseOptions rejects invalid width", () => {
  const proc = createImageProcessor(DEFAULT_CONFIG);
  const params = new URLSearchParams("width=-100");
  assertEquals(proc.parseOptions(params), null);
});

Deno.test("ImageProcessor: parseOptions rejects invalid quality", () => {
  const proc = createImageProcessor(DEFAULT_CONFIG);
  const params = new URLSearchParams("quality=200");
  assertEquals(proc.parseOptions(params), null);
});

Deno.test("ImageProcessor: parseOptions ignores invalid format", () => {
  const proc = createImageProcessor(DEFAULT_CONFIG);
  const params = new URLSearchParams("width=640&format=bmp");
  const opts = proc.parseOptions(params);
  assertEquals(opts?.width, 640);
  assertEquals(opts?.format, undefined);
});

// === isAllowedSize ===

Deno.test("ImageProcessor: isAllowedSize validates against config", () => {
  const proc = createImageProcessor(DEFAULT_CONFIG);
  assertEquals(proc.isAllowedSize(640), true);
  assertEquals(proc.isAllowedSize(1024), true);
  assertEquals(proc.isAllowedSize(500), false);
  assertEquals(proc.isAllowedSize(999), false);
});

// === process ===

Deno.test("ImageProcessor: resize to allowed width", async () => {
  const proc = createImageProcessor(DEFAULT_CONFIG);
  const input = await createTestImage(1920, 1080);

  const result = await proc.process(input, { width: 640 });

  assertEquals(result !== null, true);
  assertEquals(result!.width, 640);
  assertEquals(result!.contentType, "image/jpeg");
});

Deno.test("ImageProcessor: reject disallowed width", async () => {
  const proc = createImageProcessor(DEFAULT_CONFIG);
  const input = await createTestImage(1920, 1080);

  const result = await proc.process(input, { width: 500 });

  assertEquals(result, null);
});

Deno.test("ImageProcessor: reject disallowed height", async () => {
  const proc = createImageProcessor(DEFAULT_CONFIG);
  const input = await createTestImage(1920, 1080);

  const result = await proc.process(input, { height: 500 });

  assertEquals(result, null);
});

Deno.test("ImageProcessor: convert JPEG to WebP", async () => {
  const proc = createImageProcessor(DEFAULT_CONFIG);
  const input = await createTestImage(1920, 1080, "jpeg");

  const result = await proc.process(input, { width: 640, format: "webp" });

  assertEquals(result !== null, true);
  assertEquals(result!.contentType, "image/webp");
  assertEquals(result!.format, "webp");
});

Deno.test("ImageProcessor: convert to AVIF", async () => {
  const proc = createImageProcessor(DEFAULT_CONFIG);
  const input = await createTestImage(1920, 1080, "jpeg");

  const result = await proc.process(input, { width: 640, format: "avif" });

  assertEquals(result !== null, true);
  assertEquals(result!.contentType, "image/avif");
});

Deno.test("ImageProcessor: convert to PNG", async () => {
  const proc = createImageProcessor(DEFAULT_CONFIG);
  const input = await createTestImage(1920, 1080, "jpeg");

  const result = await proc.process(input, { width: 640, format: "png" });

  assertEquals(result !== null, true);
  assertEquals(result!.contentType, "image/png");
});

Deno.test("ImageProcessor: custom quality", async () => {
  const proc = createImageProcessor(DEFAULT_CONFIG);
  const input = await createTestImage(1920, 1080);

  const highQ = await proc.process(input, { width: 640, quality: 95 });
  const lowQ = await proc.process(input, { width: 640, quality: 20 });

  // Higher quality should produce larger files
  assertEquals(highQ !== null, true);
  assertEquals(lowQ !== null, true);
  assertEquals(highQ!.data.length > lowQ!.data.length, true);
});

Deno.test("ImageProcessor: withoutEnlargement prevents upscaling", async () => {
  const proc = createImageProcessor(DEFAULT_CONFIG);
  const input = await createTestImage(320, 240); // Small image

  const result = await proc.process(input, { width: 1920 });

  assertEquals(result !== null, true);
  // Should not enlarge beyond original 320px width
  assertEquals(result!.width <= 320, true);
});

Deno.test("ImageProcessor: resize with contain fit", async () => {
  const proc = createImageProcessor(DEFAULT_CONFIG);
  const input = await createTestImage(1920, 1080);

  const result = await proc.process(input, { width: 640, height: 640, fit: "contain" });

  assertEquals(result !== null, true);
  // With contain, the image fits within 640x640 preserving aspect ratio
  assertEquals(result!.width <= 640, true);
  assertEquals(result!.height <= 640, true);
});

Deno.test("ImageProcessor: process PNG input", async () => {
  const proc = createImageProcessor(DEFAULT_CONFIG);
  const input = await createTestImage(1920, 1080, "png");

  const result = await proc.process(input, { width: 640 });

  assertEquals(result !== null, true);
  assertEquals(result!.width, 640);
  // Default: preserves original format
  assertEquals(result!.contentType, "image/png");
});

Deno.test("ImageProcessor: process WebP input", async () => {
  const proc = createImageProcessor(DEFAULT_CONFIG);
  const input = await createTestImage(1920, 1080, "webp");

  const result = await proc.process(input, { width: 640 });

  assertEquals(result !== null, true);
  assertEquals(result!.width, 640);
  assertEquals(result!.contentType, "image/webp");
});

// === generateSrcset ===

Deno.test("ImageProcessor: generateSrcset creates variants", async () => {
  const proc = createImageProcessor(DEFAULT_CONFIG);
  const input = await createTestImage(1920, 1080);

  const variants = await proc.generateSrcset(input);

  // Should create variants for sizes smaller than 1920
  // Default allowed sizes: 320, 640, 768, 1024, 1280, 1536
  // (1920 excluded because it equals the original)
  assertEquals(variants.length > 0, true);
  assertEquals(variants.length <= 6, true);

  // Variants should be sorted by allowed_sizes order
  for (const v of variants) {
    assertEquals(DEFAULT_CONFIG.allowedSizes.includes(v.width), true);
  }
});

Deno.test("ImageProcessor: generateSrcset with format override", async () => {
  const proc = createImageProcessor(DEFAULT_CONFIG);
  const input = await createTestImage(1920, 1080, "jpeg");

  const variants = await proc.generateSrcset(input, { format: "webp" });

  for (const v of variants) {
    assertEquals(v.format, "webp");
    assertEquals(v.contentType, "image/webp");
  }
});

Deno.test("ImageProcessor: generateSrcset skips sizes >= original", async () => {
  const proc = createImageProcessor(DEFAULT_CONFIG);
  const input = await createTestImage(700, 400); // 700px wide

  const variants = await proc.generateSrcset(input);

  // Only 320 and 640 are smaller than 700
  for (const v of variants) {
    assertEquals(v.width < 700, true);
  }
});
