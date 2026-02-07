/**
 * Processed image cache — avoids re-processing the same image+params.
 *
 * Uses the storage adapter to persist cached images in the configured
 * cache directory (default: .dune/cache/images).
 *
 * Cache key = hex hash of (source path + sorted options JSON).
 * Each cached entry is stored as raw bytes alongside a small
 * .meta.json sidecar with content-type and dimensions.
 */

import { encodeHex } from "@std/encoding/hex";
import type { StorageAdapter } from "../storage/types.ts";

export interface ImageCacheConfig {
  /** Storage adapter for reading/writing cache files */
  storage: StorageAdapter;
  /** Cache directory path (relative to storage root) */
  cacheDir: string;
}

export interface CachedImage {
  data: Uint8Array;
  contentType: string;
  width: number;
  height: number;
}

interface CacheMeta {
  contentType: string;
  width: number;
  height: number;
  createdAt: number;
}

/**
 * Create an image cache backed by the storage adapter.
 */
export function createImageCache(config: ImageCacheConfig) {
  const { storage, cacheDir } = config;

  /**
   * Build a cache key from source path and processing options.
   */
  async function buildKey(
    sourcePath: string,
    options: Record<string, unknown>,
  ): Promise<string> {
    // Sort options for deterministic keys
    const sorted = Object.keys(options)
      .sort()
      .reduce((acc, key) => {
        if (options[key] !== undefined) {
          acc[key] = options[key];
        }
        return acc;
      }, {} as Record<string, unknown>);

    const input = `${sourcePath}:${JSON.stringify(sorted)}`;
    const data = new TextEncoder().encode(input);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    return encodeHex(new Uint8Array(hashBuffer)).slice(0, 16);
  }

  /**
   * Get a cached image by its key.
   * Returns null if not found or corrupted.
   */
  async function get(key: string): Promise<CachedImage | null> {
    const dataPath = `${cacheDir}/${key}.bin`;
    const metaPath = `${cacheDir}/${key}.meta.json`;

    try {
      if (!(await storage.exists(dataPath)) || !(await storage.exists(metaPath))) {
        return null;
      }

      const [data, metaBytes] = await Promise.all([
        storage.read(dataPath),
        storage.read(metaPath),
      ]);

      const meta: CacheMeta = JSON.parse(new TextDecoder().decode(metaBytes));

      return {
        data,
        contentType: meta.contentType,
        width: meta.width,
        height: meta.height,
      };
    } catch {
      return null;
    }
  }

  /**
   * Store a processed image in the cache.
   */
  async function set(
    key: string,
    image: CachedImage,
  ): Promise<void> {
    const dataPath = `${cacheDir}/${key}.bin`;
    const metaPath = `${cacheDir}/${key}.meta.json`;

    const meta: CacheMeta = {
      contentType: image.contentType,
      width: image.width,
      height: image.height,
      createdAt: Date.now(),
    };

    const metaBytes = new TextEncoder().encode(JSON.stringify(meta));

    await Promise.all([
      storage.write(dataPath, image.data),
      storage.write(metaPath, metaBytes),
    ]);
  }

  /**
   * Remove all cached images.
   */
  async function clear(): Promise<void> {
    try {
      const entries = await storage.list(cacheDir);
      const deletions = entries
        .filter((e: { isDirectory: boolean }) => !e.isDirectory)
        .map((e: { name: string }) => storage.delete(`${cacheDir}/${e.name}`));

      await Promise.all(deletions);
    } catch {
      // Cache dir may not exist yet — that's fine
    }
  }

  /**
   * Check if a cached image exists for the given key.
   */
  async function has(key: string): Promise<boolean> {
    const dataPath = `${cacheDir}/${key}.bin`;
    try {
      return await storage.exists(dataPath);
    } catch {
      return false;
    }
  }

  return { buildKey, get, set, clear, has };
}

export type ImageCache = ReturnType<typeof createImageCache>;
