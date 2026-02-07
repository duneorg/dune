/**
 * Storage module — factory for creating storage adapters.
 */

export type { StorageAdapter, StorageEntry, StorageStat, WatchEvent } from "./types.ts";
export { FileSystemAdapter } from "./fs.ts";

import type { StorageAdapter } from "./types.ts";
import { FileSystemAdapter } from "./fs.ts";

export type StorageDriver = "filesystem" | "kv";

export interface StorageOptions {
  driver?: StorageDriver;
  rootDir: string;
}

/**
 * Create a storage adapter based on the given options.
 * In v0.1, only filesystem is implemented. KV adapter comes in Phase 4.
 */
export function createStorage(options: StorageOptions): StorageAdapter {
  const driver = options.driver ?? "filesystem";

  switch (driver) {
    case "filesystem":
      return new FileSystemAdapter(options.rootDir);
    case "kv":
      // TODO: Implement Deno KV adapter in Phase 4
      throw new Error(
        "Deno KV storage adapter not yet implemented. Use 'filesystem' driver for now.",
      );
    default:
      throw new Error(`Unknown storage driver: ${driver}`);
  }
}
