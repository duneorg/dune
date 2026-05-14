/**
 * DB CLI commands:
 *   dune codegen            — generate TypeScript types from schemas/*.yaml
 *   dune migrate:generate   — generate SQL migration files from schemas
 *   dune migrate:run        — apply pending SQL migrations
 *   dune migrate:status     — show applied/pending migration status
 */

/** @module */

import { join } from "@std/path";
import { loadSchemas } from "../db/schema-parser.ts";
import { writeGeneratedFiles } from "../db/codegen.ts";
import { generateMigrations, migrationStatus, runMigrations } from "../db/migrate.ts";
import { createDbAdapter } from "../db/adapters/mod.ts";

// ---------------------------------------------------------------------------
// codegen
// ---------------------------------------------------------------------------

export async function codegenCommand(root: string): Promise<void> {
  const schemasDir = join(root, "schemas");
  const schemas = await loadSchemas(schemasDir);

  if (schemas.length === 0) {
    console.log("No schemas found in schemas/ — nothing to generate.");
    return;
  }

  const written = await writeGeneratedFiles(root, schemas);
  console.log(`Generated ${written.length} file(s):`);
  for (const path of written) {
    console.log(`  ${path}`);
  }
}

// ---------------------------------------------------------------------------
// migrate:generate
// ---------------------------------------------------------------------------

export async function migrateGenerateCommand(root: string): Promise<void> {
  const schemasDir = join(root, "schemas");
  const schemas = await loadSchemas(schemasDir);

  if (schemas.length === 0) {
    console.log("No schemas found in schemas/ — nothing to generate.");
    return;
  }

  const written = await generateMigrations(root, schemas);

  if (written.length === 0) {
    console.log("All migrations already up to date.");
    return;
  }

  console.log(`Generated ${written.length} migration file(s):`);
  for (const path of written) {
    console.log(`  ${path}`);
  }
}

// ---------------------------------------------------------------------------
// migrate:run
// ---------------------------------------------------------------------------

export async function migrateRunCommand(root: string): Promise<void> {
  const adapter = await createDbAdapter();
  try {
    const ran = await runMigrations(root, adapter);
    if (ran.length === 0) {
      console.log("No pending migrations.");
    } else {
      console.log(`Applied ${ran.length} migration(s):`);
      for (const name of ran) {
        console.log(`  ✓ ${name}`);
      }
    }
  } finally {
    await adapter.close();
  }
}

// ---------------------------------------------------------------------------
// migrate:status
// ---------------------------------------------------------------------------

export async function migrateStatusCommand(root: string): Promise<void> {
  const adapter = await createDbAdapter();
  try {
    const statuses = await migrationStatus(root, adapter);

    if (statuses.length === 0) {
      console.log("No migration files found in data/migrations/");
      return;
    }

    const maxLen = Math.max(...statuses.map((s) => s.name.length));

    for (const s of statuses) {
      const namepad = s.name.padEnd(maxLen);
      if (s.status === "applied") {
        console.log(`  ✓ ${namepad}  applied ${s.appliedAt ?? ""}`);
      } else {
        console.log(`  ○ ${namepad}  pending`);
      }
    }
  } finally {
    await adapter.close();
  }
}
