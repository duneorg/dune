/**
 * dune migrate:flex — Apply pending Flex Object schema migrations.
 *
 * Usage:
 *   dune migrate:flex [type]            Migrate all (or one) flex type
 *   dune migrate:flex [type] --dry-run  Preview without writing
 *
 * Migration files live at: {site-root}/migrations/{type}/*.ts
 * Each file must export `migration: FlexMigration`.
 *
 * Records are updated in-place (write-through) when a migration is applied.
 * Unmigrated records that have _schemaVersion >= schema.version are skipped.
 */

import { createStorage } from "../storage/mod.ts";
import { createFlexEngine } from "../flex/engine.ts";
import { loadMigrations, applyMigrations } from "../flex/migrations.ts";
import { parseUserYaml as parseYaml } from "../security/safe-yaml.ts";
import { stringify as stringifyYaml } from "@std/yaml";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FlexMigrateOptions {
  /** Restrict migration to a single flex type. Migrates all types when omitted. */
  type?: string;
  /** Preview what would be migrated without writing any files. */
  dryRun?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(msg: string): void {
  console.log(msg);
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

/**
 * Migrate Flex Object records to the current schema version.
 *
 * @param root  Site root directory (same as --root CLI flag).
 * @param opts  Command options.
 */
export async function flexMigrateCommand(
  root: string,
  opts: FlexMigrateOptions = {},
): Promise<void> {
  const { dryRun = false } = opts;
  const storage = createStorage({ rootDir: root });
  const schemasDir = "flex-objects";

  if (dryRun) {
    log("Dry run — no files will be written.\n");
  }

  // Discover which flex types to process.
  let types: string[];
  if (opts.type) {
    types = [opts.type];
  } else {
    let entries;
    try {
      entries = await storage.list(schemasDir);
    } catch {
      log("No flex-objects directory found. Nothing to migrate.");
      return;
    }
    types = entries
      .filter((e) => e.isFile && e.name.endsWith(".yaml"))
      .map((e) => e.name.slice(0, -5));
  }

  if (types.length === 0) {
    log("No flex types found. Nothing to migrate.");
    return;
  }

  let totalMigrated = 0;
  let totalSkipped = 0;

  for (const type of types) {
    // Load the schema to get the target version.
    let schema: Record<string, unknown> | null = null;
    try {
      const raw = await storage.readText(`${schemasDir}/${type}.yaml`);
      const parsed = parseYaml(raw) as Record<string, unknown>;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        schema = parsed;
      }
    } catch {
      log(`  [${type}] Schema not found — skipping.`);
      continue;
    }

    if (!schema) {
      log(`  [${type}] Schema could not be parsed — skipping.`);
      continue;
    }

    const targetVersion = typeof schema.version === "number" ? schema.version : 0;

    // Load migrations for this type.
    const migrations = await loadMigrations(root, type);

    if (migrations.length === 0 && targetVersion === 0) {
      log(`  [${type}] No migrations defined — skipping.`);
      continue;
    }

    // List all records for this type.
    let recordEntries;
    try {
      recordEntries = await storage.list(`${schemasDir}/${type}`);
    } catch {
      log(`  [${type}] No records found — skipping.`);
      continue;
    }

    const yamlFiles = recordEntries.filter((e) => e.isFile && e.name.endsWith(".yaml"));

    if (yamlFiles.length === 0) {
      log(`  [${type}] No records found — skipping.`);
      continue;
    }

    let typeMigrated = 0;
    let typeSkipped = 0;

    for (const entry of yamlFiles) {
      const recordPath = `${schemasDir}/${type}/${entry.name}`;
      let rawRecord: Record<string, unknown>;
      try {
        const raw = await storage.readText(recordPath);
        rawRecord = parseYaml(raw) as Record<string, unknown>;
      } catch {
        typeSkipped++;
        continue;
      }

      const { record: updated, migrated } = applyMigrations(
        rawRecord,
        migrations,
        targetVersion,
      );

      if (!migrated) {
        typeSkipped++;
        continue;
      }

      typeMigrated++;

      if (!dryRun) {
        // Serialize updated record — preserve key order: internal fields first.
        const { _id, _type: _t, _createdAt, _updatedAt, _schemaVersion, ...userFields } = updated;
        const meta: Record<string, unknown> = { _id, _createdAt, _updatedAt, _schemaVersion };
        const sortedUser = Object.fromEntries(
          Object.entries(userFields as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
        );
        const serialized = stringifyYaml({ ...meta, ...sortedUser }).trimEnd() + "\n";
        await storage.write(recordPath, serialized);
      }
    }

    const verb = dryRun ? "would migrate" : "migrated";
    log(
      `  [${type}] ${verb} ${typeMigrated} record(s), skipped ${typeSkipped} (already up to date) → v${targetVersion}`,
    );
    totalMigrated += typeMigrated;
    totalSkipped += typeSkipped;
  }

  log("");
  if (dryRun) {
    log(`Dry run complete: ${totalMigrated} record(s) would be migrated, ${totalSkipped} already up to date.`);
  } else {
    log(`Migration complete: ${totalMigrated} record(s) migrated, ${totalSkipped} already up to date.`);
  }
}
