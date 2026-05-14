/**
 * DbAdapter factory — auto-detects the appropriate backend.
 *
 * Selection order:
 *  1. DUNE_DB_URL starts with postgres:// or postgresql://  → PostgresAdapter
 *  2. DENO_DEPLOYMENT_ID is set (Deno Deploy)               → KVAdapter
 *  3. Otherwise                                              → SQLiteAdapter
 */

/** @module */

export { SQLiteAdapter } from "./sqlite.ts";
export { KVAdapter } from "./kv.ts";
export { PostgresAdapter } from "./postgres.ts";

import type { DbAdapter } from "../types.ts";
import { SQLiteAdapter } from "./sqlite.ts";
import { KVAdapter } from "./kv.ts";
import { PostgresAdapter } from "./postgres.ts";

/**
 * Create and return the appropriate DbAdapter based on environment variables.
 *
 * Environment variables consulted:
 *   DUNE_DB_URL      — Postgres connection string
 *   DENO_DEPLOYMENT_ID — Set by Deno Deploy; triggers KV adapter
 *   DUNE_DB_PATH     — SQLite database file path (default: data/dune.db)
 */
export async function createDbAdapter(): Promise<DbAdapter> {
  const dbUrl = Deno.env.get("DUNE_DB_URL") ?? "";
  if (dbUrl.startsWith("postgres://") || dbUrl.startsWith("postgresql://")) {
    return PostgresAdapter.open(dbUrl);
  }

  if (Deno.env.get("DENO_DEPLOYMENT_ID")) {
    return KVAdapter.open();
  }

  return SQLiteAdapter.open();
}
