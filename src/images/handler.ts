/**
 * Image HTTP handler — intercepts /content-media/* requests with
 * image processing query parameters.
 *
 * If the request has no image params (width, height, quality, format),
 * it returns null and the caller falls through to the normal media handler.
 *
 * If image params are present:
 *   1. Check cache for a pre-processed version
 *   2. On miss: read the original via engine.serveMedia()
 *   3. Process with ImageProcessor
 *   4. Cache the result
 *   5. Return with proper Content-Type and caching headers
 */

import type { DuneEngine, MediaResponse } from "../core/engine.ts";
import type { ImageProcessor } from "./processor.ts";
import type { ImageCache } from "./cache.ts";

export interface ImageHandlerOptions {
  engine: DuneEngine;
  processor: ImageProcessor;
  cache: ImageCache;
}

/** Image file extensions that the processor can handle */
const PROCESSABLE_EXTENSIONS = new Set([
  "jpg", "jpeg", "png", "webp", "avif", "gif", "tiff",
]);

export type ImageHandler = (req: Request) => Promise<Response | null>;

/**
 * Create an image-aware media handler.
 *
 * Returns a handler function that:
 * - Returns a Response if the request was handled (image processing applied)
 * - Returns null if the request should fall through to the normal media handler
 */
export function createImageHandler(options: ImageHandlerOptions): ImageHandler {
  const { engine, processor, cache } = options;

  return async function handleImageRequest(
    req: Request,
  ): Promise<Response | null> {
    const url = new URL(req.url);

    // Parse image processing options from query params
    const imageOptions = processor.parseOptions(url.searchParams);

    // No image params → fall through to normal media handler
    if (!imageOptions) {
      return null;
    }

    // Extract media path: handle both /content-media/* (legacy) and direct paths (new)
    const mediaPath = url.pathname.startsWith("/content-media/")
      ? url.pathname.replace(/^\/content-media\//, "")
      : url.pathname.slice(1);

    // Check if this is a processable image file
    const ext = mediaPath.split(".").pop()?.toLowerCase() ?? "";
    if (!PROCESSABLE_EXTENSIONS.has(ext)) {
      // Not an image — fall through to normal media handler
      return null;
    }

    // Build cache key from path + options
    const cacheKey = await cache.buildKey(mediaPath, imageOptions as Record<string, unknown>);

    // Check cache first
    const cached = await cache.get(cacheKey);
    if (cached) {
      return new Response(cached.data as unknown as BodyInit, {
        headers: {
          "Content-Type": cached.contentType,
          "Content-Length": String(cached.data.length),
          "Cache-Control": "public, max-age=31536000, immutable",
          "X-Dune-Image": "cache-hit",
        },
      });
    }

    // Cache miss — read original image from engine
    const original = await engine.serveMedia(mediaPath);
    if (!original) {
      return new Response("Image not found", { status: 404 });
    }

    // Process the image
    const processed = await processor.process(original.data, imageOptions);
    if (!processed) {
      // Processing failed (e.g. disallowed size) — return 400
      return new Response(
        JSON.stringify({ error: "Invalid image processing options" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Cache the processed image (fire-and-forget)
    cache.set(cacheKey, {
      data: processed.data,
      contentType: processed.contentType,
      width: processed.width,
      height: processed.height,
    }).catch(() => {
      // Cache write failure is non-fatal
    });

    // Return processed image
    return new Response(processed.data as unknown as BodyInit, {
      headers: {
        "Content-Type": processed.contentType,
        "Content-Length": String(processed.data.length),
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Dune-Image": "processed",
        "X-Dune-Image-Width": String(processed.width),
        "X-Dune-Image-Height": String(processed.height),
      },
    });
  };
}

