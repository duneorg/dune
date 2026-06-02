/**
 * dune migrate:roles-to-tuples
 *
 * One-time migration: for each site user whose `roles[]` array contains role
 * names, ensure the corresponding polizy group-membership tuples exist in the
 * configured authzStore (local or db).
 *
 * At runtime, `bootstrapRoleTuples()` already does this at startup — this CLI
 * command is for operators who want to run the migration explicitly, verify the
 * result, or run it on a cold DB before the server starts.
 *
 * Idempotent — skips tuples that already exist.
 *
 * Usage:
 *   dune migrate:roles-to-tuples              # apply
 *   dune migrate:roles-to-tuples --dry-run    # report without writing
 */

import { join, resolve } from "@std/path";
import { loadConfig } from "../config/mod.ts";
import { createStorage } from "../storage/mod.ts";
import { createLocalSiteUserStore } from "../auth/user-store.ts";
import { createDuneAuthSystem } from "../auth/authz.ts";
import { AuthzDbAdapter } from "../auth/authz-adapter-db.ts";
import { createDbAdapter } from "../db/adapters/mod.ts";
import { createDbSiteUserStore } from "../auth/user-store-db.ts";
import type { SiteUserStore } from "../auth/user-store.ts";

export interface MigrateRolesToTuplesOptions {
  dryRun?: boolean;
}

export async function migrateRolesToTuplesCommand(
  root: string,
  opts: MigrateRolesToTuplesOptions = {},
): Promise<void> {
  root = resolve(root);
  const { dryRun = false } = opts;

  console.log(`🏜️  Dune — migrate:roles-to-tuples${dryRun ? " (dry run)" : ""}\n`);

  const storage = createStorage({ rootDir: root });
  const config = await loadConfig({ storage, rootDir: root, skipConfigTs: true });
  const dataDir = join(root, config.admin?.dataDir ?? "data");
  const siteAuth = (config.site as { auth?: { userStore?: string; authzStore?: string } }).auth;
  const userStoreTier = siteAuth?.userStore ?? "local";
  const authzStoreTier = siteAuth?.authzStore ?? "local";

  // ── Load users ─────────────────────────────────────────────────────────────
  let userStore: SiteUserStore;
  if (userStoreTier === "db") {
    const dbAdapter = await createDbAdapter();
    userStore = await createDbSiteUserStore({ adapter: dbAdapter });
  } else {
    userStore = createLocalSiteUserStore({ storage, usersDir: `${dataDir}/site-users` });
  }

  const allUsers = await userStore.list();
  const usersWithRoles = allUsers.filter((u) => u.roles.length > 0);

  if (usersWithRoles.length === 0) {
    console.log("  ℹ️  No users with roles found — nothing to migrate.");
    return;
  }

  // ── Load authz adapter ─────────────────────────────────────────────────────
  let dbAdapter: Awaited<ReturnType<typeof createDbAdapter>> | null = null;
  let adapter: import("../auth/authz-adapter-local.ts").AuthzLocalAdapter | AuthzDbAdapter;
  let authz: Awaited<ReturnType<typeof createDuneAuthSystem>>["authz"];

  if (authzStoreTier === "db") {
    dbAdapter = await createDbAdapter();
    const bundle = createDuneAuthSystem({ authzStore: "db", dbAdapter }, storage);
    authz = bundle.authz;
    adapter = bundle.adapter as AuthzDbAdapter;
  } else {
    const bundle = createDuneAuthSystem({ authzStore: "local", dataDir }, storage);
    authz = bundle.authz;
    adapter = bundle.adapter;
  }

  // ── Migrate ────────────────────────────────────────────────────────────────
  let created = 0;
  let skipped = 0;

  for (const user of usersWithRoles) {
    for (const role of user.roles) {
      const subject = { type: "user" as const, id: user.id };
      const relation = "member";
      const object = { type: "group" as const, id: role };

      const exists = await adapter.hasTuple(subject, relation, object);
      if (exists) {
        skipped++;
        continue;
      }

      if (dryRun) {
        console.log(`  ~ user ${user.id} → group:${role} (member) — would create`);
        created++;
      } else {
        await authz.addMember({ member: subject, group: object });
        created++;
      }
    }
  }

  console.log();
  console.log(`  Created: ${created}  Skipped (already exists): ${skipped}`);

  if (dbAdapter) await dbAdapter.close();
}
