/**
 * Deno KV storage adapter.
 *
 * Implements StorageAdapter using Deno.openKv(). Suitable for Deno Deploy
 * and any environment where a persistent filesystem is unavailable.
 *
 * Key schema (multi-segment keys for efficient prefix scanning):
 *   ["f", ...pathSegments]  → Uint8Array  (file content)
 *   ["m", ...pathSegments]  → FileMeta    (mtime, size, isDir)
 *   ["c", cacheKey]         → CacheEnvelope<T>
 *
 * Path "content/01.home/default.md" becomes segments
 * ["content", "01.home", "default.md"], stored as:
 *   ["f", "content", "01.home", "default.md"] → bytes
 *   ["m", "content", "01.home", "default.md"] → { mtime, size, isDir: false }
 *
 * Implicit parent directories are materialised on write so that list() and
 * stat() work correctly without scanning the full key space.
 *
 * Limitations vs. FileSystemAdapter:
 * - watch() is a no-op — Deno Deploy has no persistent file-change source.
 *   Content rebuilds on Deploy must be triggered externally (webhook, MCP).
 * - rename() for directories is non-atomic: it is a sequence of KV mutations.
 * - Deno KV value size limit is 64 KiB per entry; individual files larger
 *   than that cannot be stored. Large binary assets (images, uploads) should
 *   use an external object store (R2/S3) — see later-roadmap.
 */

import { StorageError } from "../core/errors.ts";
import type {
  StorageAdapter,
  StorageEntry,
  StorageStat,
  WatchEvent,
} from "./types.ts";

interface FileMeta {
  mtime: number;
  size: number;
  isDir: boolean;
}

interface CacheEnvelope<T> {
  data: T;
  expires?: number;
}

function segments(path: string): string[] {
  if (!path || path === ".") return [];
  return path.split("/").filter(Boolean);
}

function segmentsToPath(segs: string[]): string {
  return segs.join("/");
}

export class KvStorageAdapter implements StorageAdapter {
  private kv: Deno.Kv;

  constructor(kv: Deno.Kv) {
    this.kv = kv;
  }

  // ---------------------------------------------------------------------------
  // File operations
  // ---------------------------------------------------------------------------

  async read(path: string): Promise<Uint8Array> {
    const key = ["f", ...segments(path)] as Deno.KvKey;
    const entry = await this.kv.get<Uint8Array>(key);
    if (entry.value === null) {
      throw new StorageError(`File not found: ${path}`, path);
    }
    return entry.value;
  }

  async readText(path: string): Promise<string> {
    const bytes = await this.read(path);
    return new TextDecoder().decode(bytes);
  }

  async write(path: string, data: Uint8Array | string): Promise<void> {
    const segs = segments(path);
    if (segs.length === 0) throw new StorageError("Cannot write to root", path);

    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
    const mtime = Date.now();
    const meta: FileMeta = { mtime, size: bytes.byteLength, isDir: false };

    let op = this.kv.atomic()
      .set(["f", ...segs] as Deno.KvKey, bytes)
      .set(["m", ...segs] as Deno.KvKey, meta);

    // Ensure every ancestor directory has a metadata entry.
    for (let i = 1; i < segs.length; i++) {
      const dirKey = ["m", ...segs.slice(0, i)] as Deno.KvKey;
      const existing = await this.kv.get<FileMeta>(dirKey);
      if (existing.value === null) {
        op = op.set(dirKey, { mtime, size: 0, isDir: true } satisfies FileMeta);
      }
    }

    await op.commit();
  }

  async exists(path: string): Promise<boolean> {
    const segs = segments(path);
    const metaEntry = await this.kv.get<FileMeta>(["m", ...segs] as Deno.KvKey);
    if (metaEntry.value !== null) return true;
    // Check for implicit directory (has children but no explicit meta entry).
    const prefix = ["m", ...segs] as Deno.KvKey;
    for await (const _ of this.kv.list({ prefix })) {
      return true;
    }
    return false;
  }

  async delete(path: string): Promise<void> {
    const segs = segments(path);
    await this.kv.atomic()
      .delete(["f", ...segs] as Deno.KvKey)
      .delete(["m", ...segs] as Deno.KvKey)
      .commit();
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const oldSegs = segments(oldPath);
    const newSegs = segments(newPath);

    const oldMeta = await this.kv.get<FileMeta>(["m", ...oldSegs] as Deno.KvKey);
    if (oldMeta.value === null) {
      throw new StorageError(`Path not found: ${oldPath}`, oldPath);
    }

    if (!oldMeta.value.isDir) {
      // File rename: copy + delete in one atomic op.
      const content = await this.kv.get<Uint8Array>(["f", ...oldSegs] as Deno.KvKey);
      if (content.value === null) {
        throw new StorageError(`File data missing: ${oldPath}`, oldPath);
      }
      await this.kv.atomic()
        .set(["f", ...newSegs] as Deno.KvKey, content.value)
        .set(["m", ...newSegs] as Deno.KvKey, oldMeta.value)
        .delete(["f", ...oldSegs] as Deno.KvKey)
        .delete(["m", ...oldSegs] as Deno.KvKey)
        .commit();
      return;
    }

    // Directory rename: enumerate all descendants, copy, delete.
    // Not atomic — done in batches of 10 mutations.
    const prefix = ["m", ...oldSegs] as Deno.KvKey;
    const toProcess: Array<{ oldKey: Deno.KvKey; newKey: Deno.KvKey; meta: FileMeta }> = [];

    for await (const entry of this.kv.list<FileMeta>({ prefix })) {
      const relSegs = (entry.key as string[]).slice(1 + oldSegs.length);
      const newKey = ["m", ...newSegs, ...relSegs] as Deno.KvKey;
      toProcess.push({ oldKey: entry.key as Deno.KvKey, newKey, meta: entry.value });
    }

    // Process in batches of 5 copy+delete pairs (10 mutations per atomic).
    for (let i = 0; i < toProcess.length; i += 5) {
      const batch = toProcess.slice(i, i + 5);
      let op = this.kv.atomic();
      for (const { oldKey, newKey, meta } of batch) {
        op = op.set(newKey, meta).delete(oldKey);
        if (!meta.isDir) {
          const oldFKey = ["f", ...(oldKey as string[]).slice(1)] as Deno.KvKey;
          const newFKey = ["f", ...(newKey as string[]).slice(1)] as Deno.KvKey;
          const fileEntry = await this.kv.get<Uint8Array>(oldFKey);
          if (fileEntry.value !== null) {
            op = op.set(newFKey, fileEntry.value).delete(oldFKey);
          }
        }
      }
      await op.commit();
    }
  }

  // ---------------------------------------------------------------------------
  // Directory listing
  // ---------------------------------------------------------------------------

  async list(path: string): Promise<StorageEntry[]> {
    const segs = segments(path);
    const prefix = ["m", ...segs] as Deno.KvKey;
    const depth = segs.length + 1; // depth of immediate children in the full key
    const entries: StorageEntry[] = [];
    const seen = new Set<string>();

    for await (const entry of this.kv.list<FileMeta>({ prefix })) {
      const key = entry.key as string[];
      // key[0] === "m"; key[1..] are path segments
      const entrySegs = key.slice(1); // all path segments
      if (entrySegs.length !== depth) continue; // skip self and deeper descendants
      const name = entrySegs[entrySegs.length - 1];
      const entryPath = segmentsToPath(entrySegs);
      if (seen.has(entryPath)) continue;
      seen.add(entryPath);
      entries.push({
        name,
        path: entryPath,
        isFile: !entry.value.isDir,
        isDirectory: entry.value.isDir,
      });
    }

    return entries.sort((a, b) => a.name.localeCompare(b.name));
  }

  async listRecursive(path: string): Promise<StorageEntry[]> {
    const segs = segments(path);
    const prefix = ["m", ...segs] as Deno.KvKey;
    const minDepth = segs.length + 1;
    const entries: StorageEntry[] = [];

    for await (const entry of this.kv.list<FileMeta>({ prefix })) {
      const key = entry.key as string[];
      const entrySegs = key.slice(1);
      if (entrySegs.length < minDepth) continue; // skip the dir itself
      const name = entrySegs[entrySegs.length - 1];
      entries.push({
        name,
        path: segmentsToPath(entrySegs),
        isFile: !entry.value.isDir,
        isDirectory: entry.value.isDir,
      });
    }

    return entries;
  }

  // ---------------------------------------------------------------------------
  // Metadata
  // ---------------------------------------------------------------------------

  async stat(path: string): Promise<StorageStat> {
    const segs = segments(path);
    const metaEntry = await this.kv.get<FileMeta>(["m", ...segs] as Deno.KvKey);

    if (metaEntry.value !== null) {
      return {
        size: metaEntry.value.size,
        mtime: metaEntry.value.mtime,
        isFile: !metaEntry.value.isDir,
        isDirectory: metaEntry.value.isDir,
      };
    }

    // Implicit directory — has children but no explicit meta.
    const prefix = ["m", ...segs] as Deno.KvKey;
    for await (const _ of this.kv.list({ prefix }, { limit: 1 })) {
      return { size: 0, mtime: 0, isFile: false, isDirectory: true };
    }

    throw new StorageError(`Path not found: ${path}`, path);
  }

  // ---------------------------------------------------------------------------
  // JSON cache
  // ---------------------------------------------------------------------------

  async getJSON<T>(key: string): Promise<T | null> {
    const entry = await this.kv.get<CacheEnvelope<T>>(["c", key]);
    if (entry.value === null) return null;
    if (entry.value.expires && Date.now() > entry.value.expires) {
      await this.kv.delete(["c", key]);
      return null;
    }
    return entry.value.data;
  }

  async setJSON<T>(key: string, value: T, ttl?: number): Promise<void> {
    const envelope: CacheEnvelope<T> = { data: value };
    if (ttl) envelope.expires = Date.now() + ttl * 1000;
    await this.kv.set(["c", key], envelope);
  }

  async deleteJSON(key: string): Promise<void> {
    await this.kv.delete(["c", key]);
  }

  // ---------------------------------------------------------------------------
  // Watch — no-op on KV/Deploy; rebuilds triggered externally.
  // ---------------------------------------------------------------------------

  watch(_path: string, _callback: (event: WatchEvent) => void): () => void {
    return () => {};
  }
}

/**
 * Open a KvStorageAdapter.
 * Pass an explicit KV URL for remote/testing; omit to use the default local KV.
 */
export async function openKvStorage(url?: string): Promise<KvStorageAdapter> {
  const kv = await Deno.openKv(url);
  return new KvStorageAdapter(kv);
}
