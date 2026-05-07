/**
 * Filesystem storage adapter.
 * Implements StorageAdapter using Deno's file system APIs.
 */

import { ensureDir } from "@std/fs";
import { dirname, isAbsolute, join, normalize, relative, resolve, SEPARATOR } from "@std/path";
import { StorageError } from "../core/errors.ts";
import type {
  StorageAdapter,
  StorageEntry,
  StorageStat,
  WatchEvent,
} from "./types.ts";

/**
 * Defense-in-depth path-containment guard. Every caller is *supposed* to
 * validate user-supplied input before it reaches storage, but a single
 * missed validator (CRIT-1, CRIT-2, CRIT-3 from the May 2026 audit) becomes
 * arbitrary filesystem read/write. This catches:
 *   - absolute paths (`/etc/passwd`)
 *   - traversal segments (`../../etc/passwd`)
 *   - NUL injection (`secret\0.png`)
 *   - paths that normalize outside rootDir
 *
 * Refs: claudedocs/security-audit-2026-05.md MED-21 (CWE-22).
 */
export class PathEscapeError extends StorageError {
  constructor(path: string) {
    super(`Path escapes storage root: ${path}`, path);
    this.name = "PathEscapeError";
  }
}

export class FileSystemAdapter implements StorageAdapter {
  private cacheDir: string;
  private rootResolved: string;

  constructor(private rootDir: string) {
    this.cacheDir = join(rootDir, ".dune", "cache");
    // Pre-resolve once so containment checks are cheap and consistent.
    this.rootResolved = resolve(rootDir);
  }

  /**
   * Map a caller-supplied relative path to an absolute filesystem path,
   * refusing anything that would escape rootDir.
   *
   * The check is intentionally string-level (not Deno.realPath-based) so
   * it works on writes to paths that don't yet exist. Symlink-based
   * escapes inside rootDir are out of scope here — a hostile admin who
   * can plant symlinks already has filesystem write authority.
   */
  private resolve(path: string): string {
    if (typeof path !== "string" || path.length === 0) {
      throw new PathEscapeError(String(path));
    }
    if (path.includes("\0")) {
      throw new PathEscapeError(path);
    }
    if (isAbsolute(path)) {
      throw new PathEscapeError(path);
    }
    const normalized = normalize(path);
    if (
      normalized === ".." ||
      normalized.startsWith(`..${SEPARATOR}`) ||
      normalized.startsWith("../") // POSIX form even on Windows builds
    ) {
      throw new PathEscapeError(path);
    }
    const full = resolve(this.rootDir, normalized);
    if (full !== this.rootResolved && !full.startsWith(this.rootResolved + SEPARATOR)) {
      throw new PathEscapeError(path);
    }
    return full;
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

  async rename(oldPath: string, newPath: string): Promise<void> {
    try {
      const oldFull = this.resolve(oldPath);
      const newFull = this.resolve(newPath);
      await ensureDir(dirname(newFull));
      await Deno.rename(oldFull, newFull);
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) {
        throw new StorageError(`Path not found: ${oldPath}`, oldPath);
      }
      throw new StorageError(`Failed to rename: ${err}`, oldPath);
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
        // info.mtime is null on FAT32, some virtual filesystems, and certain
        // network shares.  Fall back to 0 (epoch) rather than Date.now():
        //   - Date.now() produces a different value on every call, making
        //     incremental mtime comparison always report "changed" → constant
        //     full reindex on every dev-mode rebuild.
        //   - 0 is a stable sentinel meaning "mtime unknown".  After the
        //     first index the stored value is also 0, so comparisons stay
        //     consistent (the file looks unchanged until content is actually
        //     modified and its hash changes).
        // Known limitation: FAT32/HFS+ timestamps have 2-second resolution,
        // so two saves within the same 2-second window may not trigger an
        // incremental re-index.  Acceptable for a CMS editing workflow.
        mtime: info.mtime?.getTime() ?? 0,
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
      try {
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
      } catch (err) {
        // watcher.close() causes the for-await loop to throw an AbortError
        // (or similar) — that is expected and should not be logged.
        // Any other error (permissions loss, filesystem unmount, etc.) is
        // unexpected and warrants a warning so it doesn't vanish silently.
        if (running) {
          console.warn(`[dune] fs.watch: unexpected error watching "${path}": ${err}`);
        }
      }
    })();

    return () => {
      running = false;
      watcher.close();
    };
  }
}
