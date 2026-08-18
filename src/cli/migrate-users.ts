/**
 * dune migrate:users
 *
 * One-time migration for the dec-identity-unification Phase 5b store cutover:
 * reshapes existing data/users/*.json admin accounts (created before
 * @dune/plugin-admin switched to @dune/core's unified UserStore) from their
 * pre-merge shape — a single `role` field, no `provider`, no `lastSeenAt` —
 * into the current User shape (`roles: string[]`, `provider: "local"`,
 * `lastSeenAt`). Also builds the `data/users/by-email/` index, which never
 * existed for admin accounts before this cutover.
 *
 * There is no equivalent migration for the old data/site-users/ location:
 * pre-1.0 and unreleased, it never accumulated real-world data, so
 * mountDuneAuth() now points directly at data/users/ instead.
 *
 * Idempotent — records already in the current shape, and email index entries
 * that already exist, are left alone.
 *
 * Usage:
 *   dune migrate:users              # apply
 *   dune migrate:users --dry-run    # report without writing
 */

import { join, resolve } from "@std/path";
import { loadConfig } from "../config/mod.ts";
import { createStorage } from "../storage/mod.ts";

export interface MigrateUsersOptions {
  dryRun?: boolean;
}

export async function migrateUsersCommand(
  root: string,
  opts: MigrateUsersOptions = {},
): Promise<void> {
  root = resolve(root);
  const { dryRun = false } = opts;

  console.log(`🏜️  Dune — migrate:users${dryRun ? " (dry run)" : ""}\n`);

  const storage = createStorage({ rootDir: root });
  const config = await loadConfig({
    storage,
    rootDir: root,
    skipConfigTs: true,
  });
  const dataDir = join(root, config.admin?.dataDir ?? "data");
  const usersDir = join(dataDir, "users");
  const byEmailDir = join(usersDir, "by-email");

  let userFiles: string[] = [];
  try {
    for await (const e of Deno.readDir(usersDir)) {
      if (e.isFile && e.name.endsWith(".json")) {
        userFiles.push(join(usersDir, e.name));
      }
    }
  } catch {
    /* no users dir yet */
  }
  userFiles = userFiles.sort();

  if (userFiles.length === 0) {
    console.log("  ℹ️  No users found in data/users/ — nothing to migrate.");
    return;
  }

  // ── Pass 1: read every record, detect duplicate emails ──────────────────────
  // Admin accounts never had email-uniqueness enforcement before this cutover
  // (Phase 0's TOCTOU-safe locking only ever applied to the site-user store) —
  // two existing files can legitimately share an email. Building the index
  // would otherwise let the second file silently shadow the first with no
  // warning, exactly the class of bug Phase 0 fixed for site users.
  interface Loaded {
    filePath: string;
    raw: Record<string, unknown>;
    id: string;
    email: string;
  }
  const loaded: Loaded[] = [];
  let errors = 0;

  for (const filePath of userFiles) {
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(await Deno.readTextFile(filePath));
    } catch (err) {
      console.warn(`  ⚠️  Skipping corrupt file ${filePath}:`, err);
      errors++;
      continue;
    }
    const id = raw.id;
    const email = raw.email;
    if (typeof id !== "string" || typeof email !== "string" || !email) {
      console.warn(`  ⚠️  Skipping ${filePath}: missing id or email`);
      errors++;
      continue;
    }
    loaded.push({ filePath, raw, id, email });
  }

  const byEmail = new Map<string, Loaded[]>();
  for (const rec of loaded) {
    const key = rec.email.toLowerCase();
    const bucket = byEmail.get(key) ?? [];
    bucket.push(rec);
    byEmail.set(key, bucket);
  }
  for (const [email, bucket] of byEmail) {
    if (bucket.length > 1) {
      console.warn(
        `  ⚠️  ${bucket.length} accounts share email "${email}": ${
          bucket.map((r) => r.id).join(", ")
        } — only the first (by filename) will be reachable via email lookup. Resolve manually (change one account's email) if this is unintended.`,
      );
    }
  }

  // ── Pass 2: reshape + build the email index ──────────────────────────────────
  let reshaped = 0;
  let alreadyCurrent = 0;
  let indexBuilt = 0;
  let indexSkipped = 0;

  if (!dryRun) {
    await Deno.mkdir(byEmailDir, { recursive: true });
  }

  for (const [email, bucket] of byEmail) {
    const winner = bucket[0]; // first by filename — deterministic, matches the warning above

    for (const rec of bucket) {
      const isOldShape = typeof rec.raw.role === "string" &&
        !Array.isArray(rec.raw.roles);

      if (isOldShape) {
        const oldRole = rec.raw.role as string;
        const migrated: Record<string, unknown> = { ...rec.raw };
        delete migrated.role;
        migrated.roles = [oldRole];
        migrated.provider = migrated.provider ?? "local";
        migrated.lastSeenAt = migrated.lastSeenAt ?? migrated.updatedAt ??
          migrated.createdAt ?? Date.now();

        if (dryRun) {
          console.log(
            `  ~ ${rec.id} (${rec.email}) — would reshape role:"${oldRole}" → roles:["${oldRole}"]`,
          );
        } else {
          await Deno.writeTextFile(
            rec.filePath,
            JSON.stringify(migrated, null, 2),
          );
          console.log(`  ✅ ${rec.id} (${rec.email}) — reshaped`);
        }
        reshaped++;
      } else {
        alreadyCurrent++;
      }
    }

    const indexPath = join(byEmailDir, `${encodeURIComponent(email)}.json`);
    const exists = await Deno.stat(indexPath).then(() => true).catch(() =>
      false
    );
    if (exists) {
      indexSkipped++;
    } else if (dryRun) {
      console.log(`  ~ index for ${email} → ${winner.id} — would create`);
      indexBuilt++;
    } else {
      await Deno.writeTextFile(indexPath, JSON.stringify({ id: winner.id }));
      indexBuilt++;
    }
  }

  console.log();
  console.log(
    `  Users:       reshaped ${reshaped}, already current ${alreadyCurrent}, errors ${errors}`,
  );
  console.log(
    `  Email index: built ${indexBuilt}, already present ${indexSkipped}`,
  );
}
