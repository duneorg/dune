/**
 * SQLiteAdapter — default database adapter using jsr:@db/sqlite.
 *
 * DB path resolves from:
 *  1. DUNE_DB_PATH environment variable
 *  2. data/dune.db (relative to cwd)
 */

/** @module */

import type { DbAdapter } from "../types.ts";

// Dynamic import so the module can be loaded on non-SQLite environments
// without hard errors.  We type it loosely and assert at runtime.

let _DatabaseClass: typeof import("jsr:@db/sqlite").Database | null = null;

async function getDatabaseClass(): Promise<typeof import("jsr:@db/sqlite").Database> {
  if (_DatabaseClass) return _DatabaseClass;
  const mod = await import("jsr:@db/sqlite");
  _DatabaseClass = mod.Database;
  return _DatabaseClass;
}

/** Row returned by jsr:@db/sqlite query */
type RawRow = Record<string, unknown>;

/** A jsr:@db/sqlite Database instance (loosely typed for portability) */
interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
  close(): void;
  transaction<T>(fn: () => T): () => T;
}

interface SqliteStatement {
  all(...params: unknown[]): RawRow[];
  run(...params: unknown[]): { changes: number };
  value<T = unknown>(...params: unknown[]): T | undefined;
  finalize(): void;
}

export class SQLiteAdapter implements DbAdapter {
  readonly #db: SqliteDatabase;
  readonly #inTx: boolean;

  constructor(db: SqliteDatabase, inTx = false) {
    this.#db = db;
    this.#inTx = inTx;
  }

  static async open(path?: string): Promise<SQLiteAdapter> {
    const dbPath =
      path ??
      Deno.env.get("DUNE_DB_PATH") ??
      "data/dune.db";

    // Ensure parent directory exists when using a real path
    if (dbPath !== ":memory:") {
      const { dirname } = await import("@std/path");
      const dir = dirname(dbPath);
      if (dir && dir !== ".") {
        await Deno.mkdir(dir, { recursive: true });
      }
    }

    const Database = await getDatabaseClass();
    const db = new Database(dbPath) as unknown as SqliteDatabase;

    // Enable WAL mode for better concurrency
    try {
      db.exec("PRAGMA journal_mode=WAL");
      db.exec("PRAGMA foreign_keys=ON");
    } catch {
      // Ignore pragma errors (e.g. :memory: works fine without them)
    }

    return new SQLiteAdapter(db);
  }

  async query<R = unknown>(sql: string, params: unknown[] = []): Promise<R[]> {
    const stmt = this.#db.prepare(sql);
    try {
      const rows = stmt.all(...params) as R[];
      return rows;
    } finally {
      stmt.finalize();
    }
  }

  async transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T> {
    if (this.#inTx) {
      // Already inside a transaction — run directly without nesting
      return fn(this);
    }

    const txAdapter = new SQLiteAdapter(this.#db, true);

    // Use SAVEPOINT/RELEASE/ROLLBACK for async-compatible transactions
    // since jsr:@db/sqlite is synchronous but our fn() may be async.
    this.#db.exec("BEGIN");
    try {
      const result = await fn(txAdapter);
      this.#db.exec("COMMIT");
      return result;
    } catch (err) {
      try { this.#db.exec("ROLLBACK"); } catch { /* ignore rollback error */ }
      throw err;
    }
  }

  async close(): Promise<void> {
    this.#db.close();
  }

  /** Expose the raw database for schema migration use. */
  exec(sql: string): void {
    this.#db.exec(sql);
  }
}
