/**
 * Migration generator and runner.
 *
 * - `dune migrate:generate` — diff schemas against existing migrations, emit SQL
 * - `dune migrate:run`      — apply pending migrations
 * - `dune migrate:status`   — list applied / pending migrations
 */

/** @module */

import { join } from "@std/path";
import type { DbAdapter, DbFieldDef, DbFieldType, DbSchema } from "./types.ts";

// ---------------------------------------------------------------------------
// SQL generation helpers
// ---------------------------------------------------------------------------

const SQLITE_TYPE_MAP: Record<DbFieldType, string> = {
  string: "TEXT",
  text: "TEXT",
  integer: "INTEGER",
  number: "REAL",
  boolean: "INTEGER",
  datetime: "TEXT",
  json: "TEXT",
};

function sqlType(field: DbFieldDef): string {
  return SQLITE_TYPE_MAP[field.type] ?? "TEXT";
}

/**
 * Quote an identifier (table/column) for SQL. Double-quotes are doubled so a
 * name containing a quote cannot break out of the identifier. Schemas are
 * developer-authored, but quoting keeps a stray character from corrupting or
 * injecting DDL.
 */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Quote a string literal for SQL, escaping embedded single quotes. */
function quoteLiteral(value: unknown): string {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Split a SQL script into statements on `;`, ignoring semicolons inside
 * single-quoted strings or double-quoted identifiers. Doubled quotes ('' / "")
 * are treated as escaped and stay within the quoted span.
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (quote) {
      current += ch;
      if (ch === quote) {
        if (sql[i + 1] === quote) {
          current += sql[++i]; // escaped quote — consume the pair
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === ";") {
      statements.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim().length > 0) statements.push(current);
  return statements;
}

function columnDefinition(field: DbFieldDef): string {
  const parts: string[] = [quoteIdent(field.name), sqlType(field)];

  if (field.required) {
    parts.push("NOT NULL");
  }

  if (field.default !== undefined && field.default !== "now") {
    if (typeof field.default === "string" && field.type !== "datetime") {
      parts.push(`DEFAULT ${quoteLiteral(field.default)}`);
    } else if (typeof field.default === "number" || typeof field.default === "boolean") {
      parts.push(`DEFAULT ${field.default ? 1 : 0}`);
    }
  } else if (field.type === "string" && field.default === "now") {
    // Shouldn't happen but guard it
    parts.push(`DEFAULT ''`);
  }

  if (field.enum && field.enum.length > 0) {
    const values = field.enum.map((v) => quoteLiteral(v)).join(", ");
    // Rebuild: remove the simple DEFAULT we may have added, add CHECK
    const baseIdx = parts.findIndex((p) => p.startsWith("DEFAULT"));
    if (baseIdx !== -1) parts.splice(baseIdx, 1);
    const checkClause = `CHECK(${quoteIdent(field.name)} IN (${values}))`;
    if (field.default !== undefined && field.default !== "now") {
      parts.push(`DEFAULT ${quoteLiteral(field.default)}`);
    }
    parts.push(checkClause);
  }

  return parts.join(" ");
}

/** Generate a `CREATE TABLE IF NOT EXISTS` SQL statement (plus index statements) from a {@link DbSchema}. */
export function generateCreateTableSql(schema: DbSchema): string {
  const cols = [`  "id" TEXT PRIMARY KEY`];
  for (const field of schema.fields) {
    cols.push(`  ${columnDefinition(field)}`);
  }

  const lines: string[] = [
    `CREATE TABLE IF NOT EXISTS ${quoteIdent(schema.table)} (`,
    cols.join(",\n"),
    `);`,
  ];

  // Indexes
  for (const field of schema.fields) {
    if (field.index) {
      lines.push(
        `CREATE INDEX IF NOT EXISTS ${quoteIdent(`idx_${schema.table}_${field.name}`)} ON ${quoteIdent(schema.table)}(${quoteIdent(field.name)});`,
      );
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Migration tracking table
// ---------------------------------------------------------------------------

const TRACKING_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS _dune_migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);
`.trim();

// ---------------------------------------------------------------------------
// File naming
// ---------------------------------------------------------------------------

async function nextMigrationNumber(migrationsDir: string): Promise<number> {
  let max = 0;
  try {
    for await (const entry of Deno.readDir(migrationsDir)) {
      if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
      const match = entry.name.match(/^(\d+)_/);
      if (match) {
        const n = parseInt(match[1], 10);
        if (n > max) max = n;
      }
    }
  } catch {
    // Directory doesn't exist yet
  }
  return max + 1;
}

function migrationFilename(number: number, label: string): string {
  return `${String(number).padStart(4, "0")}_${label}.sql`;
}

// ---------------------------------------------------------------------------
// Public: generate migration files
// ---------------------------------------------------------------------------

/**
 * Generate SQL migration files for the given schemas.
 * One file per schema model; skips if a matching file already exists.
 *
 * Returns the list of files written.
 */
export async function generateMigrations(
  root: string,
  schemas: DbSchema[],
): Promise<string[]> {
  const migrationsDir = join(root, "data", "migrations");
  await Deno.mkdir(migrationsDir, { recursive: true });

  // Read existing migrations to figure out which tables already have one
  const existingFiles = new Set<string>();
  try {
    for await (const entry of Deno.readDir(migrationsDir)) {
      if (entry.isFile && entry.name.endsWith(".sql")) {
        existingFiles.add(entry.name);
      }
    }
  } catch {
    // No migrations dir yet
  }

  const written: string[] = [];

  for (const schema of schemas) {
    // Check if a migration for this table already exists
    const alreadyExists = [...existingFiles].some((f) =>
      f.includes(`create_${schema.table}`) || f.includes(`_${schema.table}.sql`)
    );
    if (alreadyExists) continue;

    const n = await nextMigrationNumber(migrationsDir);
    const label = `create_${schema.table}`;
    const filename = migrationFilename(n, label);
    const filePath = join(migrationsDir, filename);

    const now = new Date().toISOString();
    const content = [
      `-- Migration: ${filename.replace(".sql", "")}`,
      `-- Generated: ${now}`,
      `-- Model: ${schema.model}`,
      "",
      generateCreateTableSql(schema),
      "",
    ].join("\n");

    await Deno.writeTextFile(filePath, content);
    written.push(filePath);
    existingFiles.add(filename);
  }

  return written;
}

// ---------------------------------------------------------------------------
// Public: run pending migrations
// ---------------------------------------------------------------------------

/**
 * Apply all pending SQL migration files in `data/migrations/`.
 * Tracks applied migrations in `_dune_migrations` table.
 */
export async function runMigrations(root: string, adapter: DbAdapter): Promise<string[]> {
  const migrationsDir = join(root, "data", "migrations");

  // Ensure tracking table exists
  await adapter.query(TRACKING_TABLE_SQL, []);

  // Load applied migrations
  const applied = await adapter.query<{ name: string }>(
    `SELECT name FROM _dune_migrations ORDER BY name`,
    [],
  );
  const appliedNames = new Set(applied.map((r) => r.name));

  // Load migration files
  const files: string[] = [];
  try {
    for await (const entry of Deno.readDir(migrationsDir)) {
      if (entry.isFile && entry.name.endsWith(".sql")) {
        files.push(entry.name);
      }
    }
  } catch {
    return [];
  }
  files.sort();

  const ran: string[] = [];

  for (const filename of files) {
    if (appliedNames.has(filename)) continue;

    const filePath = join(migrationsDir, filename);
    const sql = await Deno.readTextFile(filePath);

    // Execute each statement. Split on `;` but not when it appears inside a
    // quoted string literal/identifier, so a default value or enum containing
    // a semicolon doesn't truncate the statement.
    const statements = splitSqlStatements(sql)
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith("--"));

    for (const stmt of statements) {
      await adapter.query(stmt, []);
    }

    // Record that this migration has been applied
    const now = new Date().toISOString();
    await adapter.query(
      `INSERT INTO _dune_migrations (name, applied_at) VALUES (?, ?)`,
      [filename, now],
    );

    ran.push(filename);
  }

  return ran;
}

// ---------------------------------------------------------------------------
// Public: migration status
// ---------------------------------------------------------------------------

/** Applied/pending status of a single migration file, as returned by `getMigrationStatus()`. */
export interface MigrationStatus {
  name: string;
  status: "applied" | "pending";
  appliedAt?: string;
}

/**
 * Return the status (applied / pending) of all migration files.
 */
export async function migrationStatus(root: string, adapter: DbAdapter): Promise<MigrationStatus[]> {
  const migrationsDir = join(root, "data", "migrations");

  // Ensure tracking table exists
  try {
    await adapter.query(TRACKING_TABLE_SQL, []);
  } catch {
    // Adapter may not support DDL via query() in all modes
  }

  let applied: Array<{ name: string; applied_at: string }> = [];
  try {
    applied = await adapter.query<{ name: string; applied_at: string }>(
      `SELECT name, applied_at FROM _dune_migrations ORDER BY name`,
      [],
    );
  } catch {
    applied = [];
  }
  const appliedMap = new Map(applied.map((r) => [r.name, r.applied_at]));

  const files: string[] = [];
  try {
    for await (const entry of Deno.readDir(migrationsDir)) {
      if (entry.isFile && entry.name.endsWith(".sql")) {
        files.push(entry.name);
      }
    }
  } catch {
    return [];
  }
  files.sort();

  return files.map((name) => ({
    name,
    status: appliedMap.has(name) ? "applied" : "pending",
    appliedAt: appliedMap.get(name),
  }));
}
