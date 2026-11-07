/**
 * dune migrate:config
 *
 * Rewrites camelCase config keys to snake_case in config/site.yaml,
 * config/system.yaml and config/env/<env>/{site,system}.yaml (see
 * `src/config/legacy-keys.ts` for the list). Comments, order and formatting
 * are preserved; only the key names change. Idempotent.
 *
 * Settings that moved to another file or section (the old `admin.honeypot`,
 * `admin.notifications`, `admin.incoming_webhooks`, `admin.data_dir` and the
 * `smtp:` block of form notifications) are reported for a manual move and make
 * the command exit 1.
 *
 * `admin.enabled` is removed (the admin now loads only when `plugins:` lists
 * it): `enabled: false` is deleted and the site stays without an admin;
 * otherwise the key is deleted and the admin plugin is added to the
 * `plugins:` list of config/site.yaml. Run it once: a second run on a site that
 * deliberately has no admin would add it.
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
import { parse as parseYaml, stringify as stringifyYaml } from "@std/yaml";
import {
  type ConfigFileKind,
  describeLegacyKeys,
  describeMovedKeys,
  findIgnoredKeys,
  findLegacyKeys,
  findMovedKeys,
  removeAdminBlockInText,
  removeAdminEnabledInText,
  removeIgnoredKeysInText,
  renameLegacyKeysInText,
} from "../config/legacy-keys.ts";
import { ADMIN_PLUGIN_ENTRY_SRC, addAdminPluginToText, setAdminPluginConfigInText } from "./add-admin-plugin.ts";

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

/** The keys of the old `admin:` block that are not the admin plugin's settings. */
const LIFTED: Record<string, string> = {
  runtime_dir: "runtime_dir",
  runtimeDir: "runtime_dir",
  max_revisions: "max_revisions",
  maxRevisions: "max_revisions",
  data_dir: "data_dir",
  dataDir: "data_dir",
};
/** Keys that moved to other files and need a human (see their messages). */
const ELSEWHERE = ["honeypot", "notifications", "incoming_webhooks", "incomingWebhooks"];

export interface AdminMovePlan {
  /** What goes under the admin plugin's `config:`. */
  settings: Record<string, unknown>;
  /** What goes to the top level of system.yaml. */
  lifted: Record<string, unknown>;
  /** Keys that cannot be moved automatically. */
  blocked: string[];
}

export function planAdminMove(block: unknown): AdminMovePlan {
  const plan: AdminMovePlan = { settings: {}, lifted: {}, blocked: [] };
  if (!block || typeof block !== "object" || Array.isArray(block)) return plan;
  for (const [key, value] of Object.entries(block as Record<string, unknown>)) {
    if (key in LIFTED) plan.lifted[LIFTED[key]] = value;
    else if (key === "authz_store" || key === "authzStore" || key === "enabled") continue; // removed (handled separately)
    else if (ELSEWHERE.includes(key)) plan.blocked.push(`admin.${key}`);
    else plan.settings[key] = value;
  }
  return plan;
}

export async function migrateConfigCommand(
  root: string,
  opts: MigrateConfigOptions = {},
): Promise<void> {
  root = resolve(root);
  console.log(`🏜️  Dune — migrate:config${opts.dryRun ? " (dry run)" : ""}\n`);

  let changed = 0;
  let unresolvedFiles = 0;
  let movedFiles = 0;
  // `admin.enabled`: false means the site ran without the admin and keeps doing
  // so; anything else (true, or the key absent) means it had one.
  let adminWasDisabled = false;
  for (const { path, kind } of await candidateFiles(root)) {
    let text: string;
    try {
      text = await Deno.readTextFile(path);
    } catch {
      continue; // file does not exist
    }
    const rel = path.slice(root.length + 1);
    let parsedBefore = parseYaml(text);
    if (kind === "system") {
      const admin = (parsedBefore as { admin?: { enabled?: unknown } } | null)?.admin;
      if (admin && typeof admin === "object" && "enabled" in admin) {
        if (admin.enabled === false && path === join(root, "config", "system.yaml")) adminWasDisabled = true;
        const stripped = removeAdminEnabledInText(text);
        if (stripped.removed) {
          text = stripped.text;
          parsedBefore = parseYaml(text);
          changed++;
          console.log(`  ✓ ${rel}: removed admin.enabled`);
          if (!opts.dryRun) await Deno.writeTextFile(path, text);
        } else {
          console.error(`  ✗ ${rel}: could not remove admin.enabled (flow style or quoted key); delete it by hand.`);
          unresolvedFiles++;
        }
      }
    }
    // In the base system.yaml the admin: block is moved wholesale below, so its
    // keys (and the ones we lift or drop) are not reported as "move by hand".
    const handledBelow = path === join(root, "config", "system.yaml")
      ? (k: { path: string }) => k.path === "admin" || (k.path.startsWith("admin.") && !ELSEWHERE.some((e) => k.path === `admin.${e}`))
      : (k: { path: string }) => opts.dryRun === true && k.path === "admin.enabled";
    const moved = findMovedKeys(kind, parsedBefore).filter((k) => !handledBelow(k));
    if (moved.length > 0) {
      movedFiles++;
      console.error(
        `  ✗ ${rel}: move by hand — ${describeMovedKeys(moved)}`,
      );
    }
    const legacy = findLegacyKeys(kind, parsedBefore);
    const ignored = findIgnoredKeys(kind, parsedBefore);
    if (legacy.length === 0 && ignored.length === 0) continue;

    const renamedText = renameLegacyKeysInText(kind, text);
    const result = { ...renamedText, ...removeIgnoredKeysInText(kind, renamedText.text) };
    const afterParsed = parseYaml(result.text);
    const left = findLegacyKeys(kind, afterParsed);
    const ignoredLeft = findIgnoredKeys(kind, afterParsed);
    if (ignoredLeft.length > 0) {
      unresolvedFiles++;
      console.error(
        `  ✗ ${rel}: could not remove ${ignoredLeft.map((k) => k.path).join(", ")} ` +
          `(flow style, quoted key or list item); delete these by hand. File left unchanged.`,
      );
      continue;
    }
    if (left.length > 0) {
      unresolvedFiles++;
      console.error(
        `  ✗ ${rel}: could not rewrite ${describeLegacyKeys(left)} ` +
          `(flow style, quoted key or list item); edit these by hand. File left unchanged.`,
      );
      continue;
    }
    changed++;
    const done = [
      result.renamed.length > 0 ? describeLegacyKeys(result.renamed) : "",
      result.removed.length > 0 ? `removed ${result.removed.map((k) => k.path).join(", ")} (had no effect)` : "",
    ].filter(Boolean).join("; ");
    console.log(`  ✓ ${rel}: ${done}`);
    if (!opts.dryRun) await Deno.writeTextFile(path, result.text);
  }

  // The admin: block of system.yaml. Its settings are the admin plugin's config
  // now (`config:` under its entry in site.yaml); runtime_dir, max_revisions and
  // data_dir go to the top level of system.yaml; the block is deleted.
  const systemPath = join(root, "config", "system.yaml");
  const sitePath = join(root, "config", "site.yaml");
  let systemText: string | null = null;
  let siteText: string | null = null;
  try {
    systemText = await Deno.readTextFile(systemPath);
  } catch { /* no system.yaml */ }
  try {
    siteText = await Deno.readTextFile(sitePath);
  } catch { /* no site.yaml */ }

  // Same renames the loop above applied (it did not write them on a dry run).
  if (systemText !== null) systemText = renameLegacyKeysInText("system", systemText).text;
  const adminBlock = systemText === null
    ? undefined
    : (parseYaml(systemText) as { admin?: unknown } | null)?.admin;
  const hasBlock = adminBlock !== undefined;

  if (hasBlock && systemText !== null) {
    if (adminWasDisabled) {
      const removed = removeAdminBlockInText(systemText);
      if (removed.removed) {
        changed++;
        console.log("  ✓ config/system.yaml: removed the admin: block (the admin is not loaded)");
        if (!opts.dryRun) await Deno.writeTextFile(systemPath, removed.text);
      }
    } else {
      const plan = planAdminMove(adminBlock);
      if (plan.blocked.length > 0 || siteText === null) {
        unresolvedFiles++;
        console.error(
          `  ✗ config/system.yaml: move the admin: block by hand — ` +
            (siteText === null
              ? "there is no config/site.yaml to hold the admin plugin's config"
              : `${plan.blocked.join(", ")} belong${plan.blocked.length === 1 ? "s" : ""} elsewhere (see the messages above)`),
        );
      } else {
        // 1. the admin entry in plugins:, 2. the settings under its config:
        const added = addAdminPluginToText(siteText);
        const withConfig = added.outcome === "manual"
          ? { text: siteText, outcome: "manual" as const }
          : setAdminPluginConfigInText(added.text, plan.settings);
        const removed = removeAdminBlockInText(systemText);
        if (added.outcome === "manual" || withConfig.outcome === "manual" || !removed.removed) {
          unresolvedFiles++;
          console.error(
            `  ✗ config/system.yaml: move the admin: block by hand into the admin plugin's config: in site.yaml ` +
              `(plugins: is written in a way this command cannot extend, or the entry already has a config:)`,
          );
        } else {
          let nextSystem = removed.text;
          if (Object.keys(plan.lifted).length > 0) {
            nextSystem = nextSystem.replace(/\n*$/, "\n") + stringifyYaml(plan.lifted);
          }
          changed++;
          const moved = Object.keys(plan.settings);
          console.log(
            `  ✓ config/system.yaml: moved the admin: block into the admin plugin's config:` +
              (moved.length > 0 ? ` (${moved.join(", ")})` : "") +
              (Object.keys(plan.lifted).length > 0 ? `; ${Object.keys(plan.lifted).join(", ")} now at the top level` : ""),
          );
          if (added.outcome === "added") console.log(`  ✓ config/site.yaml: added ${ADMIN_PLUGIN_ENTRY_SRC} to plugins:`);
          if (!opts.dryRun) {
            await Deno.writeTextFile(systemPath, nextSystem);
            await Deno.writeTextFile(sitePath, withConfig.text);
          }
          siteText = null; // handled
        }
      }
    }
  } else if (siteText !== null && !adminWasDisabled) {
    const added = addAdminPluginToText(siteText);
    if (added.outcome === "added") {
      changed++;
      console.log(`  ✓ config/site.yaml: added ${ADMIN_PLUGIN_ENTRY_SRC} to plugins: (core no longer loads the admin by itself)`);
      if (!opts.dryRun) await Deno.writeTextFile(sitePath, added.text);
    } else if (added.outcome === "manual") {
      unresolvedFiles++;
      console.error(
        `  ✗ config/site.yaml: add the admin by hand under plugins:\n        - src: ${ADMIN_PLUGIN_ENTRY_SRC}`,
      );
    }
  }
  if (adminWasDisabled) {
    console.log("  • admin.enabled was false: the admin plugin is not added. (Running this command again would add it.)");
  }

  if (changed === 0 && unresolvedFiles === 0 && movedFiles === 0) {
    console.log("  Nothing to migrate — all config keys are already snake_case.");
  } else if (opts.dryRun && changed > 0) {
    console.log("\n  Dry run: nothing written. Re-run without --dry-run to apply.");
  }
  if (unresolvedFiles > 0 || movedFiles > 0) Deno.exit(1);
}
