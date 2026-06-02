/**
 * AuthzDbAdapter — database-backed polizy StorageAdapter.
 *
 * All operations go directly to the DB — no in-memory index, no loadPromise.
 * Compatible with the same polizy interface as AuthzLocalAdapter.
 *
 * Table: authz_tuples
 *   subject_type TEXT, subject_id TEXT, relation TEXT,
 *   object_type TEXT, object_id TEXT,
 *   condition_valid_since TEXT, condition_valid_until TEXT
 *
 * Bulk delete uses raw SQL for efficiency (single query vs N individual deletes).
 */

import type { DbAdapter } from "../db/types.ts";

// ── Polizy StorageAdapter type aliases ─────────────────────────────────────────
interface PolizyStoredTuple {
  id: string;
  subject: { type: string; id: string };
  relation: string;
  object: { type: string; id: string };
  condition?: { validSince?: string; validUntil?: string };
}
type PolizyInputTuple = Omit<PolizyStoredTuple, "id">;
interface PolizyDeleteFilter {
  who?: { type: string; id: string };
  was?: string;
  onWhat?: { type: string; id: string };
}

// ── DB row shape ──────────────────────────────────────────────────────────────
interface TupleRow {
  id: string;
  subject_type: string;
  subject_id: string;
  relation: string;
  object_type: string;
  object_id: string;
  condition_valid_since: string | null;
  condition_valid_until: string | null;
}

function rowToTuple(row: TupleRow): PolizyStoredTuple {
  const t: PolizyStoredTuple = {
    id: row.id,
    subject: { type: row.subject_type, id: row.subject_id },
    relation: row.relation,
    object: { type: row.object_type, id: row.object_id },
  };
  if (row.condition_valid_since || row.condition_valid_until) {
    t.condition = {
      validSince: row.condition_valid_since ?? undefined,
      validUntil: row.condition_valid_until ?? undefined,
    };
  }
  return t;
}

// ── KV guard ─────────────────────────────────────────────────────────────────

/**
 * Throw a clear error when the KV adapter is used, since AuthzDbAdapter requires
 * a SQL-capable backend. KVAdapter is selected automatically on Deno Deploy when
 * DENO_DEPLOYMENT_ID is set — users must explicitly configure DUNE_DB_URL (Postgres)
 * or DUNE_DB_PATH (SQLite) to use authzStore: db on Deno Deploy.
 */
function assertNotKv(adapter: DbAdapter): void {
  // Duck-type: KVAdapter doesn't support raw SQL DDL — its query() implementation
  // throws or no-ops on CREATE TABLE. Check for a well-known KVAdapter property.
  if ("_kv" in adapter || (adapter.constructor && adapter.constructor.name === "KVAdapter")) {
    throw new Error(
      "[dune/authz] authzStore: db requires a SQL-capable database (SQLite or Postgres). " +
        "The Deno KV adapter does not support raw SQL. " +
        "Set DUNE_DB_URL (Postgres) or DUNE_DB_PATH (SQLite) to use authzStore: db, " +
        "or switch to authzStore: local.",
    );
  }
}

// ── Table bootstrap ───────────────────────────────────────────────────────────

async function ensureTable(adapter: DbAdapter): Promise<void> {
  assertNotKv(adapter);
  await adapter.query(`
    CREATE TABLE IF NOT EXISTS authz_tuples (
      id TEXT PRIMARY KEY,
      subject_type TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      relation TEXT NOT NULL,
      object_type TEXT NOT NULL,
      object_id TEXT NOT NULL,
      condition_valid_since TEXT,
      condition_valid_until TEXT
    )
  `);
  // Indexes for the hot check paths
  await adapter.query(`
    CREATE INDEX IF NOT EXISTS idx_authz_subject
      ON authz_tuples (subject_type, subject_id, relation)
  `).catch(() => {});
  await adapter.query(`
    CREATE INDEX IF NOT EXISTS idx_authz_object
      ON authz_tuples (object_type, object_id, relation)
  `).catch(() => {});
}

// ── Adapter class ─────────────────────────────────────────────────────────────

export class AuthzDbAdapter {
  private readonly db: DbAdapter;
  private ready: Promise<void> | null = null;

  constructor(adapter: DbAdapter) {
    this.db = adapter;
  }

  private ensureReady(): Promise<void> {
    if (!this.ready) this.ready = ensureTable(this.db);
    return this.ready;
  }

  async write(inputTuples: PolizyInputTuple[]): Promise<PolizyStoredTuple[]> {
    await this.ensureReady();
    const results: PolizyStoredTuple[] = [];
    for (const input of inputTuples) {
      const id = crypto.randomUUID();
      await this.db.query(
        `INSERT INTO authz_tuples
           (id, subject_type, subject_id, relation, object_type, object_id,
            condition_valid_since, condition_valid_until)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          input.subject.type,
          input.subject.id,
          input.relation,
          input.object.type,
          input.object.id,
          input.condition?.validSince ?? null,
          input.condition?.validUntil ?? null,
        ],
      );
      results.push({ ...input, id });
    }
    return results;
  }

  async delete(filter: PolizyDeleteFilter): Promise<number> {
    await this.ensureReady();

    // Build a WHERE clause from the filter — use raw SQL for a single-query delete.
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (filter.who) {
      clauses.push("subject_type = ? AND subject_id = ?");
      params.push(filter.who.type, filter.who.id);
    }
    if (filter.was !== undefined) {
      clauses.push("relation = ?");
      params.push(filter.was);
    }
    if (filter.onWhat) {
      clauses.push("object_type = ? AND object_id = ?");
      params.push(filter.onWhat.type, filter.onWhat.id);
    }

    if (clauses.length === 0) {
      // No filter — refuse to wipe everything accidentally
      return 0;
    }

    const where = clauses.join(" AND ");

    // Count matching rows before deletion so we can return an accurate count.
    // Two queries is acceptable here — this path is rare and never on the hot check path.
    const countRows = await this.db.query<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM authz_tuples WHERE ${where}`,
      params,
    );
    const count = Number(countRows[0]?.cnt ?? 0);

    if (count > 0) {
      await this.db.query(`DELETE FROM authz_tuples WHERE ${where}`, params);
    }

    return count;
  }

  async findTuples(filter: Partial<PolizyInputTuple>): Promise<PolizyStoredTuple[]> {
    await this.ensureReady();

    const clauses: string[] = [];
    const params: unknown[] = [];

    if (filter.subject) {
      clauses.push("subject_type = ? AND subject_id = ?");
      params.push(filter.subject.type, filter.subject.id);
    }
    if (filter.relation !== undefined) {
      clauses.push("relation = ?");
      params.push(filter.relation);
    }
    if (filter.object) {
      clauses.push("object_type = ? AND object_id = ?");
      params.push(filter.object.type, filter.object.id);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = await this.db.query<TupleRow>(
      `SELECT * FROM authz_tuples ${where}`,
      params,
    );
    return rows.map(rowToTuple);
  }

  async findSubjects(
    object: { type: string; id: string },
    relation: string,
    options?: { subjectType?: string },
  ): Promise<{ type: string; id: string }[]> {
    await this.ensureReady();

    const clauses = ["object_type = ?", "object_id = ?", "relation = ?"];
    const params: unknown[] = [object.type, object.id, relation];

    if (options?.subjectType) {
      clauses.push("subject_type = ?");
      params.push(options.subjectType);
    }

    const rows = await this.db.query<TupleRow>(
      `SELECT subject_type, subject_id FROM authz_tuples WHERE ${clauses.join(" AND ")}`,
      params,
    );
    return rows.map((r) => ({ type: r.subject_type, id: r.subject_id }));
  }

  async findObjects(
    subject: { type: string; id: string },
    relation: string,
    options?: { objectType?: string },
  ): Promise<{ type: string; id: string }[]> {
    await this.ensureReady();

    const clauses = ["subject_type = ?", "subject_id = ?", "relation = ?"];
    const params: unknown[] = [subject.type, subject.id, relation];

    if (options?.objectType) {
      clauses.push("object_type = ?");
      params.push(options.objectType);
    }

    const rows = await this.db.query<TupleRow>(
      `SELECT object_type, object_id FROM authz_tuples WHERE ${clauses.join(" AND ")}`,
      params,
    );
    return rows.map((r) => ({ type: r.object_type, id: r.object_id }));
  }

  // ── Helpers used by bootstrap / hasTuple check ────────────────────────────

  async size(): Promise<number> {
    await this.ensureReady();
    const rows = await this.db.query<{ cnt: number }>(
      "SELECT COUNT(*) as cnt FROM authz_tuples",
    );
    return rows[0]?.cnt ?? 0;
  }

  async hasTuple(
    subject: { type: string; id: string },
    relation: string,
    object: { type: string; id: string },
  ): Promise<boolean> {
    await this.ensureReady();
    const rows = await this.db.query<TupleRow>(
      `SELECT id FROM authz_tuples
       WHERE subject_type = ? AND subject_id = ?
         AND relation = ?
         AND object_type = ? AND object_id = ?
       LIMIT 1`,
      [subject.type, subject.id, relation, object.type, object.id],
    );
    return rows.length > 0;
  }
}
