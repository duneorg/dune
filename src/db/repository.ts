/**
 * Repository factory — creates typed Repository instances over any DbAdapter.
 *
 * Handles:
 *  - SQLite / Postgres via the query() SQL path
 *  - Deno KV via the KVAdapter-specific path
 *  - datetime serialisation (ISO 8601 ↔ Date objects)
 *  - UUID generation for new records
 *  - default/onUpdate field injection
 */

/** @module */

import type { DbAdapter, DbFieldDef, DbSchema, FindOptions, Repository, WhereClause } from "./types.ts";
import { KVAdapter } from "./adapters/kv.ts";
import { SQLiteAdapter } from "./adapters/sqlite.ts";

// ---------------------------------------------------------------------------
// UUID generation
// ---------------------------------------------------------------------------

function generateId(): string {
  return crypto.randomUUID();
}

// ---------------------------------------------------------------------------
// Date serialisation helpers
// ---------------------------------------------------------------------------

function toIso(d: Date | string | unknown): string {
  if (d instanceof Date) return d.toISOString();
  if (typeof d === "string") return d;
  return new Date().toISOString();
}

function fromIso(s: unknown): Date {
  if (s instanceof Date) return s;
  if (typeof s === "string") return new Date(s);
  return new Date();
}

// ---------------------------------------------------------------------------
// SQL WHERE clause builder
// ---------------------------------------------------------------------------

interface SqlWhere {
  sql: string;
  params: unknown[];
}

/**
 * Resolve a caller-supplied key to a safe, quoted SQL column identifier.
 *
 * Column names cannot be parameterized, so any identifier interpolated into SQL
 * must be proven safe first. We accept only "id" or an exact schema field name,
 * and additionally require `^[A-Za-z0-9_]+$`. Anything else throws rather than
 * being quoted-and-hoped, closing the quote-break-out injection vector.
 */
function safeColumn(key: string, fields: DbFieldDef[]): string {
  if (key === "id" || (fields.some((f) => f.name === key) && /^[A-Za-z0-9_]+$/.test(key))) {
    return `"${key}"`;
  }
  throw new Error(`Unknown or invalid column identifier: ${JSON.stringify(key)}`);
}

function buildWhereClause<T>(
  where: WhereClause<T>,
  fields: DbFieldDef[],
  paramOffset = 0,
): SqlWhere {
  const parts: string[] = [];
  const params: unknown[] = [];

  const datetimeFields = new Set(fields.filter((f) => f.type === "datetime").map((f) => f.name));

  function processClause(clause: WhereClause<T>): void {
    for (const [key, value] of Object.entries(clause)) {
      if (key === "$or") {
        const orParts: string[] = [];
        for (const sub of value as WhereClause<T>[]) {
          const sub_where = buildWhereClause(sub, fields, paramOffset + params.length);
          orParts.push(`(${sub_where.sql})`);
          params.push(...sub_where.params);
        }
        if (orParts.length > 0) {
          parts.push(`(${orParts.join(" OR ")})`);
        }
        continue;
      }

      const colSql = safeColumn(key, fields);
      const isDatetime = datetimeFields.has(key);

      if (value === null || value === undefined) {
        parts.push(`${colSql} IS NULL`);
        continue;
      }

      if (typeof value === "object" && !Array.isArray(value) && !(value as object instanceof Date)) {
        const ops = value as Record<string, unknown>;
        for (const [op, opVal] of Object.entries(ops)) {
          const pVal = isDatetime ? toIso(opVal) : opVal;
          switch (op) {
            case "$gt":
              parts.push(`${colSql} > ?`);
              params.push(pVal);
              break;
            case "$lt":
              parts.push(`${colSql} < ?`);
              params.push(pVal);
              break;
            case "$gte":
              parts.push(`${colSql} >= ?`);
              params.push(pVal);
              break;
            case "$lte":
              parts.push(`${colSql} <= ?`);
              params.push(pVal);
              break;
            case "$in": {
              const arr = opVal as unknown[];
              const placeholders = arr.map(() => "?").join(", ");
              parts.push(`${colSql} IN (${placeholders})`);
              params.push(...(isDatetime ? arr.map(toIso) : arr));
              break;
            }
            case "$notIn": {
              const arr = opVal as unknown[];
              const placeholders = arr.map(() => "?").join(", ");
              parts.push(`${colSql} NOT IN (${placeholders})`);
              params.push(...(isDatetime ? arr.map(toIso) : arr));
              break;
            }
            case "$contains":
              parts.push(`${colSql} LIKE ?`);
              params.push(`%${opVal}%`);
              break;
            case "$startsWith":
              parts.push(`${colSql} LIKE ?`);
              params.push(`${opVal}%`);
              break;
            case "$isNull":
              parts.push(opVal ? `${colSql} IS NULL` : `${colSql} IS NOT NULL`);
              break;
          }
        }
      } else {
        const pVal = isDatetime ? toIso(value) : value;
        parts.push(`${colSql} = ?`);
        params.push(pVal);
      }
    }
  }

  processClause(where);

  return {
    sql: parts.length > 0 ? parts.join(" AND ") : "1=1",
    params,
  };
}

// ---------------------------------------------------------------------------
// Row deserialisation
// ---------------------------------------------------------------------------

function deserialiseRow<T>(row: Record<string, unknown>, fields: DbFieldDef[]): T {
  const result: Record<string, unknown> = { ...row };

  for (const field of fields) {
    if (field.type === "datetime" && result[field.name] !== undefined && result[field.name] !== null) {
      result[field.name] = fromIso(result[field.name]);
    }
    if (field.type === "boolean" && typeof result[field.name] === "number") {
      result[field.name] = result[field.name] === 1;
    }
    if (field.type === "json" && typeof result[field.name] === "string") {
      try {
        result[field.name] = JSON.parse(result[field.name] as string);
      } catch {
        // Leave as string if JSON parsing fails
      }
    }
  }

  return result as T;
}

// ---------------------------------------------------------------------------
// Row serialisation (for insert/update)
// ---------------------------------------------------------------------------

function serialiseValue(value: unknown, field: DbFieldDef): unknown {
  if (value === undefined || value === null) return value;
  if (field.type === "datetime") return toIso(value);
  if (field.type === "boolean") return value ? 1 : 0;
  if (field.type === "json") return JSON.stringify(value);
  return value;
}

// ---------------------------------------------------------------------------
// Default injection
// ---------------------------------------------------------------------------

/**
 * Restrict a data object to keys that name a known schema column, returning
 * `[column, value]` entries ready for a SQL SET clause.
 *
 * This is the primary defense against SQL injection and mass assignment in
 * update/upsert: column identifiers are interpolated into SQL (they cannot be
 * parameterized), so any key that is not an exact schema field name — or that
 * contains characters outside `[A-Za-z0-9_]` — is dropped rather than trusted.
 * "id" is always excluded since it is the immutable primary key.
 */
function writableEntries(
  data: Record<string, unknown>,
  fields: DbFieldDef[],
): Array<[string, unknown]> {
  const allowed = new Set(fields.map((f) => f.name));
  return Object.entries(data).filter(
    ([k]) => k !== "id" && allowed.has(k) && /^[A-Za-z0-9_]+$/.test(k),
  );
}

function injectDefaults(data: Record<string, unknown>, fields: DbFieldDef[], isCreate: boolean): Record<string, unknown> {
  const result = { ...data };
  for (const field of fields) {
    if (isCreate && result[field.name] === undefined && field.default !== undefined) {
      if (field.type === "datetime" && field.default === "now") {
        result[field.name] = new Date();
      } else {
        result[field.name] = field.default;
      }
    }
    if (!isCreate && field.onUpdate === "now" && field.type === "datetime") {
      result[field.name] = new Date();
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// KV-specific where clause matching (in-memory predicate)
// ---------------------------------------------------------------------------

function matchesWhere<T extends Record<string, unknown>>(
  record: T,
  where: WhereClause<T>,
  fields: DbFieldDef[],
): boolean {
  const datetimeFields = new Set(fields.filter((f) => f.type === "datetime").map((f) => f.name));

  function compareValues(a: unknown, b: unknown, fieldName: string): boolean {
    if (datetimeFields.has(fieldName)) {
      const ta = a instanceof Date ? a.getTime() : new Date(a as string).getTime();
      const tb = b instanceof Date ? b.getTime() : new Date(b as string).getTime();
      return ta === tb;
    }
    return a === b;
  }

  function matchClause(clause: WhereClause<T>, rec: T): boolean {
    for (const [key, value] of Object.entries(clause)) {
      if (key === "$or") {
        const orClauses = value as WhereClause<T>[];
        if (!orClauses.some((sub) => matchClause(sub, rec))) return false;
        continue;
      }

      const recVal = rec[key];

      if (value === null || value === undefined) {
        if (recVal !== null && recVal !== undefined) return false;
        continue;
      }

      if (typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)) {
        const ops = value as Record<string, unknown>;
        for (const [op, opVal] of Object.entries(ops)) {
          switch (op) {
            case "$gt": {
              const a = datetimeFields.has(key) ? new Date(recVal as string).getTime() : Number(recVal);
              const b = datetimeFields.has(key) ? new Date(opVal as string).getTime() : Number(opVal);
              if (!(a > b)) return false;
              break;
            }
            case "$lt": {
              const a = datetimeFields.has(key) ? new Date(recVal as string).getTime() : Number(recVal);
              const b = datetimeFields.has(key) ? new Date(opVal as string).getTime() : Number(opVal);
              if (!(a < b)) return false;
              break;
            }
            case "$gte": {
              const a = datetimeFields.has(key) ? new Date(recVal as string).getTime() : Number(recVal);
              const b = datetimeFields.has(key) ? new Date(opVal as string).getTime() : Number(opVal);
              if (!(a >= b)) return false;
              break;
            }
            case "$lte": {
              const a = datetimeFields.has(key) ? new Date(recVal as string).getTime() : Number(recVal);
              const b = datetimeFields.has(key) ? new Date(opVal as string).getTime() : Number(opVal);
              if (!(a <= b)) return false;
              break;
            }
            case "$in": {
              const arr = opVal as unknown[];
              if (!arr.some((v) => compareValues(recVal, v, key))) return false;
              break;
            }
            case "$notIn": {
              const arr = opVal as unknown[];
              if (arr.some((v) => compareValues(recVal, v, key))) return false;
              break;
            }
            case "$contains": {
              if (typeof recVal !== "string" || !recVal.includes(opVal as string)) return false;
              break;
            }
            case "$startsWith": {
              if (typeof recVal !== "string" || !recVal.startsWith(opVal as string)) return false;
              break;
            }
            case "$isNull": {
              const isNull = recVal === null || recVal === undefined;
              if (opVal !== isNull) return false;
              break;
            }
          }
        }
      } else {
        if (!compareValues(recVal, value, key)) return false;
      }
    }
    return true;
  }

  return matchClause(where, record);
}

// ---------------------------------------------------------------------------
// SQL-based Repository (SQLite + Postgres)
// ---------------------------------------------------------------------------

function createSqlRepository<T, TCreate, TUpdate>(
  table: string,
  fields: DbFieldDef[],
  adapter: DbAdapter,
): Repository<T, TCreate, TUpdate> {
  const allColumns = ["id", ...fields.map((f) => f.name)];
  const selectCols = allColumns.map((c) => `"${c}"`).join(", ");

  function rowToT(row: Record<string, unknown>): T {
    return deserialiseRow<T>(row, fields);
  }

  return {
    async find(opts?: FindOptions<T>): Promise<T[]> {
      let sql = `SELECT ${selectCols} FROM "${table}"`;
      const params: unknown[] = [];

      if (opts?.where) {
        const w = buildWhereClause(opts.where, fields);
        sql += ` WHERE ${w.sql}`;
        params.push(...w.params);
      }

      if (opts?.orderBy) {
        if (Array.isArray(opts.orderBy)) {
          const col = safeColumn(String(opts.orderBy[0]), fields);
          const dir = String(opts.orderBy[1]).toUpperCase() === "DESC" ? "DESC" : "ASC";
          sql += ` ORDER BY ${col} ${dir}`;
        } else {
          sql += ` ORDER BY ${safeColumn(String(opts.orderBy), fields)}`;
        }
      }

      if (opts?.limit !== undefined) {
        sql += ` LIMIT ?`;
        params.push(opts.limit);
      }

      if (opts?.offset !== undefined) {
        sql += ` OFFSET ?`;
        params.push(opts.offset);
      }

      const rows = await adapter.query<Record<string, unknown>>(sql, params);
      return rows.map(rowToT);
    },

    async findOne(opts: { where: WhereClause<T> }): Promise<T | null> {
      const w = buildWhereClause(opts.where, fields);
      const sql = `SELECT ${selectCols} FROM "${table}" WHERE ${w.sql} LIMIT 2`;
      const rows = await adapter.query<Record<string, unknown>>(sql, w.params);
      if (rows.length === 0) return null;
      if (rows.length > 1) {
        throw new Error(
          `findOne on "${table}" matched ${rows.length} rows — where clause must match at most one row`,
        );
      }
      return rowToT(rows[0]);
    },

    async create(data: TCreate): Promise<T> {
      const id = generateId();
      const withDefaults = injectDefaults(data as Record<string, unknown>, fields, true);

      const columns = ["id", ...fields.map((f) => f.name).filter((n) => withDefaults[n] !== undefined)];
      const values = columns.map((c) => {
        if (c === "id") return id;
        const field = fields.find((f) => f.name === c)!;
        return serialiseValue(withDefaults[c], field);
      });
      const placeholders = columns.map(() => "?").join(", ");
      const colSql = columns.map((c) => `"${c}"`).join(", ");

      await adapter.query(
        `INSERT INTO "${table}" (${colSql}) VALUES (${placeholders})`,
        values,
      );

      const row = await adapter.query<Record<string, unknown>>(
        `SELECT ${selectCols} FROM "${table}" WHERE "id" = ?`,
        [id],
      );
      return rowToT(row[0]);
    },

    async update(id: string, data: TUpdate): Promise<{ count: number }> {
      const withOnUpdate = injectDefaults(data as Record<string, unknown>, fields, false);
      const entries = writableEntries(withOnUpdate, fields);
      if (entries.length === 0) return { count: 0 };

      const setClauses = entries.map(([col]) => `"${col}" = ?`).join(", ");
      const values = entries.map(([col, val]) => {
        const field = fields.find((f) => f.name === col);
        return field ? serialiseValue(val, field) : val;
      });
      values.push(id);

      const rows = await adapter.query<{ changes: number }>(
        `UPDATE "${table}" SET ${setClauses} WHERE "id" = ?`,
        values,
      );
      // SQLite returns changes in a different way — count via SELECT
      const countRows = await adapter.query<{ cnt: number }>(
        `SELECT changes() AS cnt`,
        [],
      );
      const count = countRows[0]?.cnt ?? 0;
      void rows;
      return { count: Number(count) };
    },

    async delete(id: string): Promise<{ count: number }> {
      await adapter.query(`DELETE FROM "${table}" WHERE "id" = ?`, [id]);
      const countRows = await adapter.query<{ cnt: number }>(
        `SELECT changes() AS cnt`,
        [],
      );
      return { count: Number(countRows[0]?.cnt ?? 0) };
    },

    async count(opts?: { where?: WhereClause<T> }): Promise<number> {
      let sql = `SELECT COUNT(*) AS cnt FROM "${table}"`;
      const params: unknown[] = [];
      if (opts?.where) {
        const w = buildWhereClause(opts.where, fields);
        sql += ` WHERE ${w.sql}`;
        params.push(...w.params);
      }
      const rows = await adapter.query<{ cnt: number }>(sql, params);
      return Number(rows[0]?.cnt ?? 0);
    },

    async upsert(where: WhereClause<T>, data: TCreate): Promise<T> {
      // For SQLite: use INSERT OR REPLACE with a subquery to preserve the id
      // For Postgres: use INSERT ... ON CONFLICT DO UPDATE
      // We implement this as a transaction to handle both.

      return adapter.transaction(async (tx) => {
        const withDefaults = injectDefaults(data as Record<string, unknown>, fields, true);

        // Check if a matching row exists
        const w = buildWhereClause(where, fields);
        const existing = await tx.query<Record<string, unknown>>(
          `SELECT "id" FROM "${table}" WHERE ${w.sql} LIMIT 1`,
          w.params,
        );

        if (existing.length > 0) {
          // Update existing row
          const id = existing[0].id as string;
          const updateData = injectDefaults(data as Record<string, unknown>, fields, false);
          const entries = writableEntries(updateData, fields);
          if (entries.length > 0) {
            const setClauses = entries.map(([col]) => `"${col}" = ?`).join(", ");
            const values = entries.map(([col, val]) => {
              const field = fields.find((f) => f.name === col);
              return field ? serialiseValue(val, field) : val;
            });
            values.push(id);
            await tx.query(`UPDATE "${table}" SET ${setClauses} WHERE "id" = ?`, values);
          }

          const row = await tx.query<Record<string, unknown>>(
            `SELECT ${selectCols} FROM "${table}" WHERE "id" = ?`,
            [id],
          );
          return rowToT(row[0]);
        } else {
          // Insert new row
          const id = generateId();
          const columns = ["id", ...fields.map((f) => f.name).filter((n) => withDefaults[n] !== undefined)];
          const values = columns.map((c) => {
            if (c === "id") return id;
            const field = fields.find((f) => f.name === c)!;
            return serialiseValue(withDefaults[c], field);
          });
          const placeholders = columns.map(() => "?").join(", ");
          const colSql = columns.map((c) => `"${c}"`).join(", ");

          await tx.query(
            `INSERT INTO "${table}" (${colSql}) VALUES (${placeholders})`,
            values,
          );

          const row = await tx.query<Record<string, unknown>>(
            `SELECT ${selectCols} FROM "${table}" WHERE "id" = ?`,
            [id],
          );
          return rowToT(row[0]);
        }
      });
    },

    getAdapter(): DbAdapter {
      return adapter;
    },
  };
}

// ---------------------------------------------------------------------------
// KV-based Repository
// ---------------------------------------------------------------------------

function createKvRepository<T, TCreate, TUpdate>(
  table: string,
  fields: DbFieldDef[],
  adapter: KVAdapter,
): Repository<T, TCreate, TUpdate> {
  // Register indexed fields on the KVAdapter
  const indexedFieldNames = fields.filter((f) => f.index).map((f) => f.name);
  adapter.registerIndexedFields(table, indexedFieldNames);

  function kvRecordToT(id: string, record: Record<string, unknown>): T {
    const row = { ...record, id };
    return deserialiseRow<T>(row, fields);
  }

  function serialiseForKv(data: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const field of fields) {
      if (data[field.name] !== undefined) {
        result[field.name] = serialiseValue(data[field.name], field);
      }
    }
    return result;
  }

  async function allRecords(): Promise<Array<{ id: string; record: Record<string, unknown> }>> {
    const entries = await adapter.kvList(table);
    return entries.map(({ id, value }) => ({ id, record: value }));
  }

  return {
    async find(opts?: FindOptions<T>): Promise<T[]> {
      let all = await allRecords();
      let records = all.map(({ id, record }) => kvRecordToT(id, record));

      if (opts?.where) {
        records = records.filter((r) => matchesWhere(r as Record<string, unknown>, opts.where!, fields));
      }

      if (opts?.orderBy) {
        const [col, dir] = Array.isArray(opts.orderBy)
          ? [opts.orderBy[0] as string, opts.orderBy[1]]
          : [opts.orderBy as string, "asc" as const];

        records.sort((a, b) => {
          const av = (a as Record<string, unknown>)[col] as string | number | boolean | null | undefined;
          const bv = (b as Record<string, unknown>)[col] as string | number | boolean | null | undefined;
          const cmp = (av ?? "") < (bv ?? "") ? -1 : (av ?? "") > (bv ?? "") ? 1 : 0;
          return dir === "desc" ? -cmp : cmp;
        });
      }

      const offset = opts?.offset ?? 0;
      const limit = opts?.limit;
      records = records.slice(offset, limit !== undefined ? offset + limit : undefined);

      return records;
    },

    async findOne(opts: { where: WhereClause<T> }): Promise<T | null> {
      const all = await allRecords();
      const matches = all
        .map(({ id, record }) => kvRecordToT(id, record))
        .filter((r) => matchesWhere(r as Record<string, unknown>, opts.where, fields));

      if (matches.length === 0) return null;
      if (matches.length > 1) {
        throw new Error(
          `findOne on "${table}" matched ${matches.length} rows — where clause must match at most one row`,
        );
      }
      return matches[0];
    },

    async create(data: TCreate): Promise<T> {
      const id = generateId();
      const withDefaults = injectDefaults(data as Record<string, unknown>, fields, true);
      const serialised = serialiseForKv(withDefaults);
      await adapter.kvSet(table, id, serialised);
      return kvRecordToT(id, serialised);
    },

    async update(id: string, data: TUpdate): Promise<{ count: number }> {
      const existing = await adapter.kvGet(table, id);
      if (!existing) return { count: 0 };

      const withOnUpdate = injectDefaults(data as Record<string, unknown>, fields, false);
      const updated = { ...existing, ...serialiseForKv(withOnUpdate) };
      await adapter.kvSet(table, id, updated);
      return { count: 1 };
    },

    async delete(id: string): Promise<{ count: number }> {
      const deleted = await adapter.kvDelete(table, id);
      return { count: deleted ? 1 : 0 };
    },

    async count(opts?: { where?: WhereClause<T> }): Promise<number> {
      const all = await allRecords();
      if (!opts?.where) return all.length;
      return all.filter(({ id, record }) =>
        matchesWhere(kvRecordToT(id, record) as Record<string, unknown>, opts.where!, fields)
      ).length;
    },

    async upsert(where: WhereClause<T>, data: TCreate): Promise<T> {
      const all = await allRecords();
      const existing = all.find(({ id, record }) =>
        matchesWhere(kvRecordToT(id, record) as Record<string, unknown>, where, fields)
      );

      if (existing) {
        const withOnUpdate = injectDefaults(data as Record<string, unknown>, fields, false);
        const updated = { ...existing.record, ...serialiseForKv(withOnUpdate) };
        await adapter.kvSet(table, existing.id, updated);
        return kvRecordToT(existing.id, updated);
      } else {
        const id = generateId();
        const withDefaults = injectDefaults(data as Record<string, unknown>, fields, true);
        const serialised = serialiseForKv(withDefaults);
        await adapter.kvSet(table, id, serialised);
        return kvRecordToT(id, serialised);
      }
    },

    getAdapter(): DbAdapter {
      return adapter;
    },
  };
}

// ---------------------------------------------------------------------------
// Public factory function
// ---------------------------------------------------------------------------

/**
 * Create a typed Repository for `table` backed by `adapter`.
 *
 * `fields` is the list of DbFieldDef from the parsed schema (id excluded).
 */
export function createRepository<T, TCreate, TUpdate>(
  table: string,
  adapter: DbAdapter,
  fields: DbFieldDef[] = [],
): Repository<T, TCreate, TUpdate> {
  if (adapter instanceof KVAdapter) {
    return createKvRepository<T, TCreate, TUpdate>(table, fields, adapter);
  }
  return createSqlRepository<T, TCreate, TUpdate>(table, fields, adapter);
}

/**
 * Convenience overload that accepts a full DbSchema.
 */
export function createRepositoryFromSchema<T, TCreate, TUpdate>(
  schema: DbSchema,
  adapter: DbAdapter,
): Repository<T, TCreate, TUpdate> {
  return createRepository<T, TCreate, TUpdate>(schema.table, adapter, schema.fields);
}
