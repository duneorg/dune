/**
 * KVAdapter — Deno KV-backed database adapter.
 *
 * Auto-selected when `DENO_DEPLOYMENT_ID` is set (Deno Deploy).
 *
 * Limitations (documented):
 * - Non-id where clauses require a full prefix scan — O(n).
 * - Index-assisted exact-match lookups are O(1) for `index: true` fields.
 *
 * Key layout:
 *   ["db", tableName, id]                         — primary record
 *   ["db_idx", tableName, fieldName, fieldValue, id]  — secondary index (exact match)
 */

/** @module */

import type { DbAdapter } from "../types.ts";

type KvRecord = Record<string, unknown>;

export class KVAdapter implements DbAdapter {
  readonly #kv: Deno.Kv;
  /** Fields that have a secondary index: tableName -> Set<fieldName> */
  readonly #indexedFields: Map<string, Set<string>>;

  constructor(kv: Deno.Kv, indexedFields?: Map<string, Set<string>>) {
    this.#kv = kv;
    this.#indexedFields = indexedFields ?? new Map();
  }

  static async open(path?: string): Promise<KVAdapter> {
    const kv = await Deno.openKv(path);
    return new KVAdapter(kv);
  }

  /**
   * Register which fields are indexed for a table.
   * Call this after opening the adapter, before issuing queries.
   */
  registerIndexedFields(table: string, fields: string[]): void {
    this.#indexedFields.set(table, new Set(fields));
  }

  // ---------------------------------------------------------------------------
  // DbAdapter implementation
  // ---------------------------------------------------------------------------

  async query<R = unknown>(sql: string, _params?: unknown[]): Promise<R[]> {
    // The KV adapter does not execute raw SQL.
    // This method exists to satisfy the DbAdapter interface for escape-hatch
    // use — callers that need raw KV access should use getAdapter() and cast.
    void sql;
    throw new Error(
      "KVAdapter does not support raw SQL queries. " +
        "Use the Repository API or access Deno.Kv directly via getAdapter().",
    );
  }

  async transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T> {
    // Deno KV supports atomic operations but not generic async transactions.
    // We expose the same adapter instance — callers that need atomics should
    // use the atomic() API directly on the KV handle.
    return fn(this);
  }

  async close(): Promise<void> {
    this.#kv.close();
  }

  // ---------------------------------------------------------------------------
  // Internal helpers used by the repository layer
  // ---------------------------------------------------------------------------

  /** Store a record and maintain secondary indexes. */
  async kvSet(table: string, id: string, record: KvRecord): Promise<void> {
    const op = this.#kv.atomic();
    op.set(["db", table, id], record);

    // Maintain index entries for indexed fields
    const indexed = this.#indexedFields.get(table);
    if (indexed) {
      for (const field of indexed) {
        const val = record[field];
        if (val !== undefined && val !== null) {
          op.set(["db_idx", table, field, String(val), id], id);
        }
      }
    }

    const res = await op.commit();
    if (!res.ok) throw new Error(`KV atomic set failed for ${table}/${id}`);
  }

  /** Delete a record and remove its secondary indexes. */
  async kvDelete(table: string, id: string): Promise<boolean> {
    // Read existing record to find indexed field values to remove
    const existing = await this.#kv.get<KvRecord>(["db", table, id]);
    if (existing.value === null) return false;

    const op = this.#kv.atomic();
    op.delete(["db", table, id]);

    const indexed = this.#indexedFields.get(table);
    if (indexed && existing.value) {
      for (const field of indexed) {
        const val = existing.value[field];
        if (val !== undefined && val !== null) {
          op.delete(["db_idx", table, field, String(val), id]);
        }
      }
    }

    const res = await op.commit();
    return res.ok;
  }

  /** Get one record by primary key. */
  async kvGet(table: string, id: string): Promise<KvRecord | null> {
    const entry = await this.#kv.get<KvRecord>(["db", table, id]);
    return entry.value ?? null;
  }

  /**
   * List all records for a table (full prefix scan).
   * Returns an async iterator-compatible array.
   */
  async kvList(table: string): Promise<Array<{ id: string; value: KvRecord }>> {
    const results: Array<{ id: string; value: KvRecord }> = [];
    const iter = this.#kv.list<KvRecord>({ prefix: ["db", table] });
    for await (const entry of iter) {
      const id = entry.key[2] as string;
      results.push({ id, value: entry.value });
    }
    return results;
  }

  /**
   * Index-assisted exact-match lookup.
   * Returns matching IDs, or null if the field is not indexed.
   */
  async kvIndexLookup(
    table: string,
    field: string,
    value: unknown,
  ): Promise<string[] | null> {
    const indexed = this.#indexedFields.get(table);
    if (!indexed?.has(field)) return null;

    const ids: string[] = [];
    const iter = this.#kv.list<string>({
      prefix: ["db_idx", table, field, String(value)],
    });
    for await (const entry of iter) {
      ids.push(entry.value);
    }
    return ids;
  }

  /** Expose the underlying Deno.Kv for advanced use cases. */
  get kv(): Deno.Kv {
    return this.#kv;
  }
}
