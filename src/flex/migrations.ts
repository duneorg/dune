/**
 * Flex Object schema migrations.
 *
 * Migration files live at: `migrations/{type}/{version}_{description}.ts`
 * (or any filename — files are sorted lexicographically so numeric prefixes
 * like `001_add_status.ts` guarantee a stable order).
 *
 * Each migration file must export a named `migration: FlexMigration`.
 *
 * @example migrations/products/001_add_status.ts
 * ```ts
 * import type { FlexMigration } from "../../src/flex/migrations.ts";
 *
 * export const migration: FlexMigration = {
 *   version: 1,
 *   description: "Add status field with default value",
 *   up(record) {
 *     return { ...record, status: record.status ?? "draft" };
 *   },
 * };
 * ```
 */

/** A single schema migration that transforms a record from the previous version. */
export interface FlexMigration {
  /** Target schema version this migration reaches. */
  version: number;
  /** Human-readable description shown in migration summaries. */
  description: string;
  /**
   * Transform a record from (version - 1) to this version.
   * Must be a pure function — do not mutate the input record.
   */
  up: (record: Record<string, unknown>) => Record<string, unknown>;
}

/**
 * Load all migrations for a given flex type from disk.
 *
 * Looks for TypeScript files in `{root}/migrations/{type}/`.  Each file must
 * export a named `migration: FlexMigration`.  Files are imported in
 * lexicographic filename order so numeric prefixes (`001_`, `002_`, …) give a
 * reliable sequencing strategy.
 *
 * Returns an empty array when the directory does not exist.
 */
export async function loadMigrations(root: string, type: string): Promise<FlexMigration[]> {
  const dir = `${root}/migrations/${type}`;

  let entries: Deno.DirEntry[];
  try {
    entries = [];
    for await (const entry of Deno.readDir(dir)) {
      entries.push(entry);
    }
  } catch {
    // Directory does not exist — no migrations defined for this type.
    return [];
  }

  // Filter to TypeScript source files only.
  const tsFiles = entries
    .filter((e) => e.isFile && (e.name.endsWith(".ts") || e.name.endsWith(".js")))
    .map((e) => e.name)
    .sort(); // lexicographic order

  const migrations: FlexMigration[] = [];

  for (const filename of tsFiles) {
    const filePath = `${dir}/${filename}`;
    try {
      // Dynamic import — the file URL must be absolute.
      const absPath = filePath.startsWith("/") ? filePath : `${Deno.cwd()}/${filePath}`;
      const mod = await import(`file://${absPath}`);
      if (mod.migration && typeof mod.migration.up === "function") {
        migrations.push(mod.migration as FlexMigration);
      }
    } catch {
      // Skip unloadable files — don't crash the whole read path.
    }
  }

  // Sort by target version number as the authoritative ordering signal.
  migrations.sort((a, b) => a.version - b.version);

  return migrations;
}

/**
 * Apply pending migrations to a single record.
 *
 * The record's `_schemaVersion` field (a number, defaults to 0) indicates the
 * last migration version that has already been applied.  Only migrations with
 * `version > record._schemaVersion && version <= targetVersion` are run, in
 * ascending version order.
 *
 * Returns the (possibly updated) record and a flag indicating whether any
 * migration was applied.  The returned record always has `_schemaVersion` set
 * to the highest applied version (or the existing value if nothing ran).
 */
export function applyMigrations(
  record: Record<string, unknown>,
  migrations: FlexMigration[],
  targetVersion: number,
): { record: Record<string, unknown>; migrated: boolean } {
  const currentVersion = typeof record._schemaVersion === "number"
    ? record._schemaVersion
    : 0;

  if (currentVersion >= targetVersion || migrations.length === 0) {
    // Ensure _schemaVersion is present even when nothing runs.
    if (typeof record._schemaVersion !== "number") {
      return {
        record: { ...record, _schemaVersion: currentVersion },
        migrated: false,
      };
    }
    return { record, migrated: false };
  }

  // Collect only the migrations that need to run.
  const pending = migrations
    .filter((m) => m.version > currentVersion && m.version <= targetVersion)
    .sort((a, b) => a.version - b.version);

  if (pending.length === 0) {
    return { record, migrated: false };
  }

  let current = record;
  for (const migration of pending) {
    current = migration.up(current);
  }

  const highestApplied = pending[pending.length - 1].version;
  return {
    record: { ...current, _schemaVersion: highestApplied },
    migrated: true,
  };
}
