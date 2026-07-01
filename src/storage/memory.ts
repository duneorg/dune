/**
 * In-memory storage adapter — for testing and ephemeral environments.
 *
 * Backed by a plain `Map<string, Uint8Array>`. All paths are relative to an
 * implicit root (no disk I/O of any kind). Useful for bootstrapping a Dune
 * instance with fixture content in tests without writing to the filesystem.
 */

import type { StorageAdapter, StorageEntry, StorageStat, WatchEvent } from "./types.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * An in-memory `StorageAdapter` backed by a `Map`.
 *
 * Create it, pre-populate with fixture content via {@link set}, then pass it
 * to `bootstrapWithStorage()` in `@dune/testing`.
 *
 * ```ts
 * const storage = new MemoryStorageAdapter();
 * storage.set("content/01.home/default.md", "---\ntitle: Home\n---\nHello");
 * ```
 */
export class MemoryStorageAdapter implements StorageAdapter {
  private readonly files = new Map<string, Uint8Array>();
  private readonly jsonCache = new Map<string, { value: unknown; expires?: number }>();

  /** Pre-populate a file. Accepts string or Uint8Array. */
  set(path: string, data: string | Uint8Array): void {
    this.files.set(
      normPath(path),
      typeof data === "string" ? encoder.encode(data) : data,
    );
  }

  /** Remove all files (useful for resetting between tests). */
  clear(): void {
    this.files.clear();
    this.jsonCache.clear();
  }

  // ── StorageAdapter ─────────────────────────────────────────────────────────

  async read(path: string): Promise<Uint8Array> {
    const data = this.files.get(normPath(path));
    if (!data) throw new StorageNotFoundError(path);
    return data;
  }

  async readText(path: string): Promise<string> {
    return decoder.decode(await this.read(path));
  }

  async write(path: string, data: Uint8Array | string): Promise<void> {
    this.files.set(
      normPath(path),
      typeof data === "string" ? encoder.encode(data) : data,
    );
  }

  async exists(path: string): Promise<boolean> {
    const norm = normPath(path);
    if (this.files.has(norm)) return true;
    // Also true if any file is under this as a directory prefix.
    const prefix = norm.endsWith("/") ? norm : norm + "/";
    for (const key of this.files.keys()) {
      if (key.startsWith(prefix)) return true;
    }
    return false;
  }

  async delete(path: string): Promise<void> {
    this.files.delete(normPath(path));
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const old = normPath(oldPath);
    const neo = normPath(newPath);
    const data = this.files.get(old);
    if (data === undefined) throw new StorageNotFoundError(oldPath);
    this.files.delete(old);
    this.files.set(neo, data);
    // Also rename any files under oldPath as a directory.
    const prefix = old + "/";
    for (const [k, v] of this.files.entries()) {
      if (k.startsWith(prefix)) {
        this.files.delete(k);
        this.files.set(neo + "/" + k.slice(prefix.length), v);
      }
    }
  }

  async list(path: string): Promise<StorageEntry[]> {
    const dir = normPath(path);
    const prefix = dir === "" ? "" : dir + "/";
    const seen = new Set<string>();
    const entries: StorageEntry[] = [];

    for (const key of this.files.keys()) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      if (!rest) continue;
      const segment = rest.split("/")[0];
      if (seen.has(segment)) continue;
      seen.add(segment);
      const isFile = !rest.includes("/");
      const fullPath = prefix + segment;
      entries.push({
        name: segment,
        path: fullPath,
        isFile,
        isDirectory: !isFile,
      });
    }

    return entries;
  }

  async listRecursive(path: string): Promise<StorageEntry[]> {
    const dir = normPath(path);
    const prefix = dir === "" ? "" : dir + "/";
    const entries: StorageEntry[] = [];

    for (const key of this.files.keys()) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      if (!rest) continue;
      const name = rest.split("/").at(-1)!;
      entries.push({
        name,
        path: key,
        isFile: true,
        isDirectory: false,
      });
    }

    return entries;
  }

  async stat(path: string): Promise<StorageStat> {
    const norm = normPath(path);
    const data = this.files.get(norm);
    if (data !== undefined) {
      return { size: data.byteLength, mtime: 0, isFile: true, isDirectory: false };
    }
    const prefix = norm + "/";
    for (const key of this.files.keys()) {
      if (key.startsWith(prefix)) {
        return { size: 0, mtime: 0, isFile: false, isDirectory: true };
      }
    }
    throw new StorageNotFoundError(path);
  }

  async getJSON<T>(key: string): Promise<T | null> {
    const entry = this.jsonCache.get(key);
    if (!entry) return null;
    if (entry.expires && entry.expires < Date.now()) {
      this.jsonCache.delete(key);
      return null;
    }
    return entry.value as T;
  }

  async setJSON<T>(key: string, value: T, ttl?: number): Promise<void> {
    this.jsonCache.set(key, {
      value,
      expires: ttl ? Date.now() + ttl * 1000 : undefined,
    });
  }

  async deleteJSON(key: string): Promise<void> {
    this.jsonCache.delete(key);
  }

  watch(_path: string, _callback: (event: WatchEvent) => void): () => void {
    return () => {};
  }
}

class StorageNotFoundError extends Error {
  constructor(path: string) {
    super(`MemoryStorageAdapter: not found: ${path}`);
    this.name = "StorageNotFoundError";
  }
}

/** Normalize a path: strip leading slash, collapse double slashes. */
function normPath(p: string): string {
  return p.replace(/^\/+/, "").replace(/\/+/g, "/").replace(/\/$/, "");
}
