/**
 * dune authz:sign — Sign existing unsigned permission tuple files.
 *
 * Reads all data/permissions/*.json files, signs each one that is either
 * unsigned (no `hmac` field) or carries an invalid signature, and writes the
 * updated file back to disk.
 *
 * Requires DUNE_AUTHZ_HMAC_SECRET to be set.
 *
 * Usage:
 *   dune authz:sign              # sign all files in the configured data dir
 *   dune authz:sign --dry-run    # print what would be signed without writing
 */

import { join, resolve } from "@std/path";
import { loadHmacKeyFromEnv, signTuple, verifyTuple } from "../auth/authz-hmac.ts";
import type { SignedTuple } from "../auth/authz-hmac.ts";
import { loadConfig } from "../config/mod.ts";
import { createStorage } from "../storage/mod.ts";

export interface AuthzSignOptions {
  dryRun?: boolean;
}

export async function authzSignCommand(root: string, opts: AuthzSignOptions = {}): Promise<void> {
  root = resolve(root);
  const { dryRun = false } = opts;

  console.log(`🏜️  Dune — authz:sign${dryRun ? " (dry run)" : ""}\n`);

  // Load HMAC key — errors hard if secret is absent or too short
  const hmacKey = await loadHmacKeyFromEnv().catch((err) => {
    console.error(`  ✗ ${err.message}`);
    Deno.exit(1);
  });

  if (!hmacKey) {
    console.error("  ✗ DUNE_AUTHZ_HMAC_SECRET is not set — cannot sign tuples.");
    console.error("    Set the env var and re-run.");
    Deno.exit(1);
  }

  const storage = createStorage({ rootDir: root });
  const config = await loadConfig({ storage, rootDir: root, skipConfigTs: true });
  const dataDir = config.admin?.dataDir ?? "data";
  const permissionsDir = join(root, dataDir, "permissions");

  let entries: Deno.DirEntry[] = [];
  try {
    for await (const e of Deno.readDir(permissionsDir)) {
      if (e.isFile && e.name.endsWith(".json")) entries.push(e);
    }
  } catch {
    console.log("  ℹ️  No permissions directory found — nothing to sign.");
    return;
  }

  entries = entries.sort((a, b) => a.name.localeCompare(b.name));

  let signed = 0;
  let alreadySigned = 0;
  let skipped = 0;

  for (const entry of entries) {
    const filePath = join(permissionsDir, entry.name);
    let tuple: SignedTuple;

    try {
      tuple = JSON.parse(await Deno.readTextFile(filePath)) as SignedTuple;
    } catch {
      console.warn(`  ⚠ ${entry.name}: failed to parse — skipped`);
      skipped++;
      continue;
    }

    if (!tuple.id) {
      console.warn(`  ⚠ ${entry.name}: missing id field — skipped`);
      skipped++;
      continue;
    }

    const status = await verifyTuple(tuple, hmacKey);

    if (status === "ok") {
      alreadySigned++;
      continue; // already correctly signed
    }

    const { hmac: _old, ...base } = tuple;
    const newHmac = await signTuple(base, hmacKey);
    const updated: SignedTuple = { ...base, hmac: newHmac };

    if (dryRun) {
      const reason = status === "missing" ? "unsigned" : "invalid signature";
      console.log(`  ~ ${entry.name} (${reason}) — would sign`);
    } else {
      await Deno.writeTextFile(filePath, JSON.stringify(updated, null, 2));
      console.log(`  ✅ ${entry.name}`);
    }
    signed++;
  }

  console.log();
  if (dryRun) {
    console.log(`  Would sign: ${signed}  Already signed: ${alreadySigned}  Skipped: ${skipped}`);
  } else {
    console.log(`  Signed: ${signed}  Already signed: ${alreadySigned}  Skipped: ${skipped}`);
    if (signed > 0) {
      console.log(`\n  All tuple files are now signed with the current DUNE_AUTHZ_HMAC_SECRET.`);
    }
  }
}
