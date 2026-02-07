/**
 * Storage abstraction layer types.
 * Both filesystem and Deno KV adapters implement StorageAdapter.
 */

/** Unified storage interface */
export interface StorageAdapter {
  /** Read raw bytes from a path */
  read(path: string): Promise<Uint8Array>;

  /** Read text content from a path */
  readText(path: string): Promise<string>;

  /** Write data to a path (creates parent directories as needed) */
  write(path: string, data: Uint8Array | string): Promise<void>;

  /** Check if a path exists */
  exists(path: string): Promise<boolean>;

  /** Delete a file at path */
  delete(path: string): Promise<void>;

  /** List immediate children of a directory */
  list(path: string): Promise<StorageEntry[]>;

  /** List all descendants of a directory recursively */
  listRecursive(path: string): Promise<StorageEntry[]>;

  /** Get file/directory metadata */
  stat(path: string): Promise<StorageStat>;

  /** Get a cached JSON value by key */
  getJSON<T>(key: string): Promise<T | null>;

  /** Set a cached JSON value with optional TTL (seconds) */
  setJSON<T>(key: string, value: T, ttl?: number): Promise<void>;

  /** Delete a cached JSON value */
  deleteJSON(key: string): Promise<void>;

  /** Watch a path for changes (returns unsubscribe function) */
  watch(path: string, callback: (event: WatchEvent) => void): () => void;
}

/** Entry in a directory listing */
export interface StorageEntry {
  /** Filename (not full path) */
  name: string;
  /** Full path relative to storage root */
  path: string;
  /** Whether this entry is a file */
  isFile: boolean;
  /** Whether this entry is a directory */
  isDirectory: boolean;
}

/** File/directory metadata */
export interface StorageStat {
  /** File size in bytes */
  size: number;
  /** Last modification time as unix timestamp (ms) */
  mtime: number;
  /** Whether this is a file */
  isFile: boolean;
  /** Whether this is a directory */
  isDirectory: boolean;
}

/** Filesystem change event */
export interface WatchEvent {
  kind: "create" | "modify" | "remove";
  paths: string[];
}
