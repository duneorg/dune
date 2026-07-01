/**
 * Storage module — factory for creating storage adapters.
 */

export type { StorageAdapter, StorageEntry, StorageStat, WatchEvent } from "./types.ts";
export { FileSystemAdapter } from "./fs.ts";
export { KvStorageAdapter, openKvStorage } from "./kv.ts";
export { MemoryStorageAdapter } from "./memory.ts";

import type { StorageAdapter } from "./types.ts";
import { FileSystemAdapter } from "./fs.ts";
import { openKvStorage } from "./kv.ts";

/** Storage backend identifier. */
export type StorageDriver = "filesystem" | "kv";

/** Options for storage factories. */
export interface StorageOptions {
  driver?: StorageDriver;
  rootDir: string;
  /** Deno KV URL — only used when driver is "kv". Defaults to the local KV store. */
  kvUrl?: string;
}

/**
 * Create a filesystem storage adapter synchronously.
 * Used by CLI commands that always operate on local files.
 * Throws if driver is "kv" — use {@link createStorageAsync} instead.
 */
export function createStorage(options: StorageOptions): StorageAdapter {
  const driver = options.driver ?? "filesystem";
  if (driver === "kv") {
    throw new Error("KV storage requires async init — use createStorageAsync()");
  }
  return new FileSystemAdapter(options.rootDir);
}

/**
 * Create a storage adapter, auto-selecting KV when DENO_KV_URL is set.
 * Used by the server bootstrap path (bootstrap.ts, multisite manager).
 */
export async function createStorageAsync(options: StorageOptions): Promise<StorageAdapter> {
  const driver = options.driver ?? (Deno.env.get("DENO_KV_URL") ? "kv" : "filesystem");

  switch (driver) {
    case "filesystem":
      return new FileSystemAdapter(options.rootDir);
    case "kv":
      return await openKvStorage(options.kvUrl ?? Deno.env.get("DENO_KV_URL"));
    default:
      throw new Error(`Unknown storage driver: ${driver}`);
  }
}
