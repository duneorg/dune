/**
 * Filesystem storage adapter.
 * Implements StorageAdapter using Deno's file system APIs.
 */

import { ensureDir } from "@std/fs";
import { dirname, join, relative } from "@std/path";
import { StorageError } from "../core/errors.ts";
import type {
  StorageAdapter,
  StorageEntry,
  StorageStat,
  WatchEvent,
} from "./types.ts";

export class FileSystemAdapter implements StorageAdapter {
  private cacheDir: string;

  constructor(private rootDir: string) {
    this.cacheDir = join(rootDir, ".dune", "cache");
  }

  private resolve(path: string): string {
    return join(this.rootDir, path);
  }

  async read(path: string): Promise<Uint8Array> {
    try {
      return await Deno.readFile(this.resolve(path));
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) {
        throw new StorageError(`File not found: ${path}`, path);
      }
      throw new StorageError(`Failed to read file: ${err}`, path);
    }
  }

  async readText(path: string): Promise<string> {
    try {
      return await Deno.readTextFile(this.resolve(path));
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) {
        throw new StorageError(`File not found: ${path}`, path);
      }
      throw new StorageError(`Failed to read file: ${err}`, path);
    }
  }

  async write(path: string, data: Uint8Array | string): Promise<void> {
    const fullPath = this.resolve(path);
    await ensureDir(dirname(fullPath));
    if (typeof data === "string") {
      await Deno.writeTextFile(fullPath, data);
    } else {
      await Deno.writeFile(fullPath, data);
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      await Deno.stat(this.resolve(path));
      return true;
    } catch {
      return false;
    }
  }

  async delete(path: string): Promise<void> {
    try {
      await Deno.remove(this.resolve(path));
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) {
        throw new StorageError(`Failed to delete: ${err}`, path);
      }
    }
  }

  async list(path: string): Promise<StorageEntry[]> {
    const entries: StorageEntry[] = [];
    const fullPath = this.resolve(path);

    try {
      for await (const entry of Deno.readDir(fullPath)) {
        entries.push({
          name: entry.name,
          path: join(path, entry.name),
          isFile: entry.isFile,
          isDirectory: entry.isDirectory,
        });
      }
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) {
        throw new StorageError(`Directory not found: ${path}`, path);
      }
      throw new StorageError(`Failed to list directory: ${err}`, path);
    }

    return entries.sort((a, b) => a.name.localeCompare(b.name));
  }

  async listRecursive(path: string): Promise<StorageEntry[]> {
    const entries: StorageEntry[] = [];

    const walk = async (dir: string): Promise<void> => {
      const items = await this.list(dir);
      for (const item of items) {
        entries.push(item);
        if (item.isDirectory) {
          await walk(item.path);
        }
      }
    };

    await walk(path);
    return entries;
  }

  async stat(path: string): Promise<StorageStat> {
    try {
      const info = await Deno.stat(this.resolve(path));
      return {
        size: info.size,
        mtime: info.mtime?.getTime() ?? Date.now(),
        isFile: info.isFile,
        isDirectory: info.isDirectory,
      };
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) {
        throw new StorageError(`Path not found: ${path}`, path);
      }
      throw new StorageError(`Failed to stat: ${err}`, path);
    }
  }

  // --- Cache/KV operations (JSON files in .dune/cache/) ---

  private cacheKeyToPath(key: string): string {
    const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, "_");
    return join(this.cacheDir, `${safeKey}.json`);
  }

  async getJSON<T>(key: string): Promise<T | null> {
    const filePath = this.cacheKeyToPath(key);
    try {
      const text = await Deno.readTextFile(filePath);
      const envelope = JSON.parse(text) as {
        data: T;
        expires?: number;
      };

      if (envelope.expires && Date.now() > envelope.expires) {
        // TTL expired, clean up
        await Deno.remove(filePath).catch(() => {});
        return null;
      }

      return envelope.data;
    } catch {
      return null;
    }
  }

  async setJSON<T>(key: string, value: T, ttl?: number): Promise<void> {
    const filePath = this.cacheKeyToPath(key);
    await ensureDir(dirname(filePath));

    const envelope: { data: T; expires?: number } = { data: value };
    if (ttl) {
      envelope.expires = Date.now() + ttl * 1000;
    }

    await Deno.writeTextFile(filePath, JSON.stringify(envelope));
  }

  async deleteJSON(key: string): Promise<void> {
    const filePath = this.cacheKeyToPath(key);
    try {
      await Deno.remove(filePath);
    } catch {
      // Ignore if not found
    }
  }

  // --- File watching ---

  watch(path: string, callback: (event: WatchEvent) => void): () => void {
    const fullPath = this.resolve(path);
    const watcher = Deno.watchFs(fullPath);
    let running = true;

    (async () => {
      for await (const event of watcher) {
        if (!running) break;

        const kind = event.kind === "create"
          ? "create"
          : event.kind === "modify"
          ? "modify"
          : event.kind === "remove"
          ? "remove"
          : null;

        if (kind) {
          callback({
            kind,
            paths: event.paths.map((p) => relative(this.rootDir, p)),
          });
        }
      }
    })();

    return () => {
      running = false;
      watcher.close();
    };
  }
}
