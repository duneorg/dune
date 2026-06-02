/**
 * dune migrate:auth-to-db
 *
 * One-time migration: reads flat-file site user records and permission tuples,
 * imports them into the configured DB, then updates site.yaml to enable
 * `userStore: db` and `authzStore: db`.
 *
 * Idempotent — existing records (matched by id) are skipped.
 *
 * Usage:
 *   dune migrate:auth-to-db              # migrate + update site.yaml
 *   dune migrate:auth-to-db --dry-run    # report what would be migrated, no writes
 */

import { join, resolve } from "@std/path";
import { loadConfig } from "../config/mod.ts";
import { createStorage } from "../storage/mod.ts";
import { createDbAdapter } from "../db/adapters/mod.ts";
import { createDbSiteUserStore } from "../auth/user-store-db.ts";
import { AuthzDbAdapter } from "../auth/authz-adapter-db.ts";
import type { SiteUser } from "../auth/types.ts";

export interface MigrateAuthToDbOptions {
  dryRun?: boolean;
}

export async function migrateAuthToDbCommand(
  root: string,
  opts: MigrateAuthToDbOptions = {},
): Promise<void> {
  root = resolve(root);
  const { dryRun = false } = opts;

  console.log(`🏜️  Dune — migrate:auth-to-db${dryRun ? " (dry run)" : ""}\n`);

  const storage = createStorage({ rootDir: root });
  const config = await loadConfig({ storage, rootDir: root, skipConfigTs: true });
  const dataDir = join(root, config.admin?.dataDir ?? "data");

  const dbAdapter = await createDbAdapter();

  // ── Site users ──────────────────────────────────────────────────────────────
  const usersDir = join(dataDir, "site-users");
  let userFiles: string[] = [];
  try {
    for await (const e of Deno.readDir(usersDir)) {
      if (e.isFile && e.name.endsWith(".json")) userFiles.push(join(usersDir, e.name));
    }
  } catch { /* no users dir */ }

  userFiles = userFiles.sort();

  let usersImported = 0;
  let usersSkipped = 0;

  if (userFiles.length > 0) {
    const dbStore = dryRun ? null : await createDbSiteUserStore({ adapter: dbAdapter });

    for (const filePath of userFiles) {
      const user = JSON.parse(await Deno.readTextFile(filePath)) as SiteUser;
      if (!user.id) { usersSkipped++; continue; }

      if (dryRun) {
        console.log(`  ~ user ${user.id} (${user.email}) — would import`);
        usersImported++;
        continue;
      }

      const existing = await dbStore!.getById(user.id);
      if (existing) {
        usersSkipped++;
      } else {
        await dbStore!.create({
          ...user,
          enabled: user.enabled ?? true,
        });
        usersImported++;
        console.log(`  ✅ user ${user.id} (${user.email})`);
      }
    }
  }

  // ── Authz tuples ────────────────────────────────────────────────────────────
  const permissionsDir = join(dataDir, "permissions");
  let tupleFiles: string[] = [];
  try {
    for await (const e of Deno.readDir(permissionsDir)) {
      if (e.isFile && e.name.endsWith(".json")) tupleFiles.push(join(permissionsDir, e.name));
    }
  } catch { /* no permissions dir */ }

  tupleFiles = tupleFiles.sort();

  let tuplesImported = 0;
  let tuplesSkipped = 0;

  if (tupleFiles.length > 0) {
    const dbAuthz = dryRun ? null : new AuthzDbAdapter(dbAdapter);

    for (const filePath of tupleFiles) {
      const tuple = JSON.parse(await Deno.readTextFile(filePath));
      if (!tuple.id || !tuple.subject || !tuple.relation || !tuple.object) {
        tuplesSkipped++;
        continue;
      }

      if (dryRun) {
        console.log(`  ~ tuple ${tuple.id} — would import`);
        tuplesImported++;
        continue;
      }

      const exists = await dbAuthz!.hasTuple(tuple.subject, tuple.relation, tuple.object);
      if (exists) {
        tuplesSkipped++;
      } else {
        // Use raw SQL to preserve the existing ID
        await dbAdapter.query(
          `INSERT OR IGNORE INTO authz_tuples
             (id, subject_type, subject_id, relation, object_type, object_id,
              condition_valid_since, condition_valid_until)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            tuple.id,
            tuple.subject.type, tuple.subject.id,
            tuple.relation,
            tuple.object.type, tuple.object.id,
            tuple.condition?.validSince ?? null,
            tuple.condition?.validUntil ?? null,
          ],
        );
        tuplesImported++;
        console.log(`  ✅ tuple ${tuple.id}`);
      }
    }
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log();
  console.log(`  Users:   imported ${usersImported}, skipped ${usersSkipped}`);
  console.log(`  Tuples:  imported ${tuplesImported}, skipped ${tuplesSkipped}`);

  if (!dryRun && (usersImported > 0 || tuplesImported > 0)) {
    console.log(`\n  ℹ️  Update site.yaml to activate the db tier:`);
    console.log(`     auth:`);
    console.log(`       userStore: db`);
    console.log(`       authzStore: db`);
  }

  await dbAdapter.close();
}
