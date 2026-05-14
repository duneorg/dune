/**
 * PostgresAdapter — PostgreSQL-backed database adapter using npm:postgres.
 *
 * Selected when `DUNE_DB_URL` starts with `postgres://` or `postgresql://`.
 */

/** @module */

import type { DbAdapter } from "../types.ts";

// Lazy-loaded postgres client to avoid import errors when not used.
type PostgresClient = {
  // deno-lint-ignore no-explicit-any
  unsafe(sql: string, params?: unknown[]): Promise<any[]>;
  // deno-lint-ignore no-explicit-any
  begin<T>(fn: (sql: PostgresClient) => Promise<T>): Promise<T>;
  end(): Promise<void>;
};

type PostgresMod = {
  default: new (url: string) => PostgresClient;
};

let _sqlClient: PostgresClient | null = null;

async function getClient(url: string): Promise<PostgresClient> {
  if (_sqlClient) return _sqlClient;
  const mod = await import("npm:postgres") as unknown as PostgresMod;
  _sqlClient = new mod.default(url);
  return _sqlClient;
}

export class PostgresAdapter implements DbAdapter {
  readonly #sql: PostgresClient;

  constructor(sql: PostgresClient) {
    this.#sql = sql;
  }

  static async open(url?: string): Promise<PostgresAdapter> {
    const dbUrl =
      url ??
      Deno.env.get("DUNE_DB_URL") ??
      "";

    if (!dbUrl) {
      throw new Error(
        "PostgresAdapter requires DUNE_DB_URL to be set " +
          "(e.g. postgres://user:pass@host:5432/dbname).",
      );
    }

    if (!dbUrl.startsWith("postgres://") && !dbUrl.startsWith("postgresql://")) {
      throw new Error(
        `Invalid DUNE_DB_URL: expected postgres:// or postgresql:// but got: ${dbUrl}`,
      );
    }

    const client = await getClient(dbUrl);
    return new PostgresAdapter(client);
  }

  async query<R = unknown>(sql: string, params: unknown[] = []): Promise<R[]> {
    try {
      const rows = await this.#sql.unsafe(sql, params);
      return rows as R[];
    } catch (err) {
      // Do NOT include `sql` in the error message — it can contain table names,
      // column names, or literal values that reveal internal schema details to
      // callers. Log a sanitised message; callers should never expose this error
      // to end users.
      throw new Error(
        `PostgresAdapter query error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T> {
    return this.#sql.begin(async (txSql) => {
      const txAdapter = new PostgresAdapter(txSql);
      return fn(txAdapter);
    });
  }

  async close(): Promise<void> {
    await this.#sql.end();
    _sqlClient = null;
  }
}
