/**
 * dune migrate:config
 *
 * Rewrites camelCase config keys to snake_case in config/site.yaml,
 * config/system.yaml and config/env/<env>/{site,system}.yaml (see
 * `src/config/legacy-keys.ts` for the list). Comments, order and formatting
 * are preserved; only the key names change. Idempotent.
 *
 * Keys it cannot reach (flow style `{a: 1}`, quoted keys, mappings inside list
 * items) are reported and the file is left untouched so you can edit it by
 * hand.
 *
 * Usage:
 *   dune migrate:config              # apply
 *   dune migrate:config --dry-run    # report without writing
 */

import { join, resolve } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import {
  type ConfigFileKind,
  describeLegacyKeys,
  findLegacyKeys,
  renameLegacyKeysInText,
} from "../config/legacy-keys.ts";

export interface MigrateConfigOptions {
  dryRun?: boolean;
}

async function candidateFiles(root: string): Promise<{ path: string; kind: ConfigFileKind }[]> {
  const files: { path: string; kind: ConfigFileKind }[] = [];
  const dirs = [join(root, "config")];
  try {
    for await (const e of Deno.readDir(join(root, "config", "env"))) {
      if (e.isDirectory) dirs.push(join(root, "config", "env", e.name));
    }
  } catch { /* no env overlays */ }
  for (const dir of dirs) {
    for (const kind of ["site", "system"] as const) {
      files.push({ path: join(dir, `${kind}.yaml`), kind });
    }
  }
  return files;
}

export async function migrateConfigCommand(
  root: string,
  opts: MigrateConfigOptions = {},
): Promise<void> {
  root = resolve(root);
  console.log(`🏜️  Dune — migrate:config${opts.dryRun ? " (dry run)" : ""}\n`);

  let changed = 0;
  let unresolvedFiles = 0;
  for (const { path, kind } of await candidateFiles(root)) {
    let text: string;
    try {
      text = await Deno.readTextFile(path);
    } catch {
      continue; // file does not exist
    }
    const rel = path.slice(root.length + 1);
    const legacy = findLegacyKeys(kind, parseYaml(text));
    if (legacy.length === 0) continue;

    const result = renameLegacyKeysInText(kind, text);
    const left = findLegacyKeys(kind, parseYaml(result.text));
    if (left.length > 0) {
      unresolvedFiles++;
      console.error(
        `  ✗ ${rel}: could not rewrite ${describeLegacyKeys(left)} ` +
          `(flow style, quoted key or list item); edit these by hand. File left unchanged.`,
      );
      continue;
    }
    changed++;
    console.log(`  ✓ ${rel}: ${describeLegacyKeys(result.renamed)}`);
    if (!opts.dryRun) await Deno.writeTextFile(path, result.text);
  }

  if (changed === 0 && unresolvedFiles === 0) {
    console.log("  Nothing to migrate — all config keys are already snake_case.");
  } else if (opts.dryRun && changed > 0) {
    console.log("\n  Dry run: nothing written. Re-run without --dry-run to apply.");
  }
  if (unresolvedFiles > 0) Deno.exit(1);
}
