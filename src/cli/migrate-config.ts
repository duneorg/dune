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
  removeAdminEnabledInText,
  removeIgnoredKeysInText,
  removeTopLevelKeyInText,
  renameLegacyKeysInText,
} from "../config/legacy-keys.ts";
import {
  addAdminPluginToText,
  ADMIN_PLUGIN_ENTRY_SRC,
  setAdminPluginConfigInText,
} from "./add-admin-plugin.ts";

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

/** `machine_translation:` keys that were camelCase and are snake_case in the plugin's config. */
const MT_RENAMES: Record<string, string> = { apiKey: "api_key", baseUrl: "base_url" };

export function planAdminMove(block: unknown, machineTranslation?: unknown): AdminMovePlan {
  const plan: AdminMovePlan = { settings: {}, lifted: {}, blocked: [] };
  if (
    machineTranslation && typeof machineTranslation === "object" &&
    !Array.isArray(machineTranslation)
  ) {
    plan.settings.machine_translation = Object.fromEntries(
      Object.entries(machineTranslation as Record<string, unknown>).map((
        [k, v],
      ) => [MT_RENAMES[k] ?? k, v]),
    );
  }
  if (!block || typeof block !== "object" || Array.isArray(block)) return plan;
  for (const [key, value] of Object.entries(block as Record<string, unknown>)) {
    if (key in LIFTED) plan.lifted[LIFTED[key]] = value;
    else if (key === "authz_store" || key === "authzStore" || key === "enabled") continue; // removed (handled separately)
    else if (ELSEWHERE.includes(key)) plan.blocked.push(`admin.${key}`);
    else plan.settings[key] = value;
  }
  return plan;
}

/**
 * Append the lifted keys to the top level of a system.yaml text. A key the file
 * already has with the same value is skipped; one with a different value is a
 * conflict (writing it twice would make the file unparseable), reported for a
 * manual decision.
 */
export function liftToTopLevel(
  text: string,
  lifted: Record<string, unknown>,
): { text: string; conflicts: string[] } {
  const existing = (parseYaml(text) as Record<string, unknown> | null) ?? {};
  const conflicts: string[] = [];
  const toAdd: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(lifted)) {
    if (!(key in existing)) toAdd[key] = value;
    else if (JSON.stringify(existing[key]) !== JSON.stringify(value)) conflicts.push(key);
  }
  const out = Object.keys(toAdd).length > 0
    ? text.replace(/\n*$/, "\n") + stringifyYaml(toAdd)
    : text;
  return { text: out, conflicts };
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
  // Overlay files (config/environments/<env>/system.yaml) that switched the admin off for that
  // environment only. The plugin list is not per environment here, so they lose that.
  const adminDisabledInOverlays: string[] = [];
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
        if (admin.enabled === false) {
          if (path === join(root, "config", "system.yaml")) adminWasDisabled = true;
          else adminDisabledInOverlays.push(rel);
        }
        const stripped = removeAdminEnabledInText(text);
        if (stripped.removed) {
          text = stripped.text;
          parsedBefore = parseYaml(text);
          // An environment overlay whose whole admin: block was enabled leaves an empty key
          // behind, which would be reported as a block to move by hand. Nothing is left to
          // move, so drop it. (In the base file the whole block is moved below.)
          if (path !== join(root, "config", "system.yaml")) {
            const left = (parsedBefore as { admin?: unknown } | null)?.admin;
            const empty = left === null || left === undefined ||
              (typeof left === "object" && Object.keys(left as object).length === 0);
            if (empty) {
              text = removeTopLevelKeyInText("system", text, "admin").text;
              parsedBefore = parseYaml(text);
            }
          }
          changed++;
          console.log(`  ✓ ${rel}: removed admin.enabled`);
          if (!opts.dryRun) await Deno.writeTextFile(path, text);
        } else {
          console.error(
            `  ✗ ${rel}: could not remove admin.enabled (flow style or quoted key); delete it by hand.`,
          );
          unresolvedFiles++;
        }
      }
    }
    // In the base system.yaml the admin: block is moved wholesale below, so its
    // keys (and the ones we lift or drop) are not reported as "move by hand".
    const handledBelow = path === join(root, "config", "system.yaml")
      ? (k: { path: string }) =>
        k.path === "admin" ||
        (k.path.startsWith("admin.") && !ELSEWHERE.some((e) => k.path === `admin.${e}`))
      : path === join(root, "config", "site.yaml")
      ? (k: { path: string }) => k.path === "machine_translation"
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
      result.removed.length > 0
        ? `removed ${result.removed.map((k) => k.path).join(", ")} (had no effect)`
        : "",
    ].filter(Boolean).join("; ");
    console.log(`  ✓ ${rel}: ${done}`);
    if (!opts.dryRun) await Deno.writeTextFile(path, result.text);
  }

  // The admin's settings: the `admin:` block of system.yaml and `machine_translation:` of
  // site.yaml. They are the admin plugin's config now (`config:` under its entry in
  // site.yaml); runtime_dir, max_revisions and data_dir go to the top level of
  // system.yaml; the old blocks are deleted.
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
  const mtBlock = siteText === null
    ? undefined
    : (parseYaml(siteText) as { machine_translation?: unknown } | null)?.machine_translation;
  const hasAdminSettings = adminBlock !== undefined || mtBlock !== undefined;

  const write = async (path: string, text: string) => {
    if (!opts.dryRun) await Deno.writeTextFile(path, text);
  };

  if (hasAdminSettings) {
    if (adminWasDisabled) {
      // The admin is not loaded, so its own settings have nowhere to go: drop them.
      // What is not the admin's (runtime_dir, max_revisions, data_dir are core settings;
      // honeypot, notifications and incoming_webhooks belong to forms and webhooks) is kept.
      const plan = planAdminMove(adminBlock, mtBlock);
      let nextSystem = systemText;
      let nextSite = siteText;
      if (adminBlock !== undefined && nextSystem !== null) {
        nextSystem = removeTopLevelKeyInText("system", nextSystem, "admin").text;
      }
      if (mtBlock !== undefined && nextSite !== null) {
        nextSite = removeTopLevelKeyInText("site", nextSite, "machine_translation").text;
      }
      const lifted = nextSystem !== null && Object.keys(plan.lifted).length > 0
        ? liftToTopLevel(nextSystem, plan.lifted)
        : { text: nextSystem, conflicts: [] as string[] };
      if (plan.blocked.length > 0 || lifted.conflicts.length > 0) {
        unresolvedFiles++;
        console.error(
          `  ✗ move the admin's settings by hand — ` +
            (plan.blocked.length > 0
              ? `${plan.blocked.join(", ")} belong${
                plan.blocked.length === 1 ? "s" : ""
              } elsewhere (see the messages above)`
              : `${lifted.conflicts.join(", ")} ${
                lifted.conflicts.length === 1 ? "is" : "are"
              } also set at the top level of system.yaml with a different value`),
        );
      } else {
        changed++;
        console.log(
          "  ✓ removed the admin: block and machine_translation (the admin is not loaded)" +
            (Object.keys(plan.lifted).length > 0
              ? `; ${Object.keys(plan.lifted).join(", ")} now at the top level of system.yaml`
              : ""),
        );
        if (lifted.text !== null && adminBlock !== undefined) await write(systemPath, lifted.text);
        if (nextSite !== null && mtBlock !== undefined) await write(sitePath, nextSite);
      }
    } else {
      const plan = planAdminMove(adminBlock, mtBlock);
      if (plan.blocked.length > 0 || siteText === null) {
        unresolvedFiles++;
        console.error(
          `  ✗ move the admin's settings by hand — ` +
            (siteText === null
              ? "there is no config/site.yaml to hold the admin plugin's config"
              : `${plan.blocked.join(", ")} belong${
                plan.blocked.length === 1 ? "s" : ""
              } elsewhere (see the messages above)`),
        );
      } else {
        // 1. the admin entry in plugins:, 2. the settings under its config:, 3. delete the old blocks
        const added = addAdminPluginToText(siteText);
        const withConfig = added.outcome === "manual"
          ? { text: siteText, outcome: "manual" as const }
          : setAdminPluginConfigInText(added.text, plan.settings);
        const nextSite = mtBlock !== undefined
          ? removeTopLevelKeyInText("site", withConfig.text, "machine_translation")
          : { text: withConfig.text, removed: true };
        const nextSystemRemoved = adminBlock !== undefined && systemText !== null
          ? removeTopLevelKeyInText("system", systemText, "admin")
          : { text: systemText ?? "", removed: true };
        const lifted = liftToTopLevel(nextSystemRemoved.text, plan.lifted);
        if (lifted.conflicts.length > 0) {
          unresolvedFiles++;
          console.error(
            `  ✗ move the admin's settings by hand — ${lifted.conflicts.join(", ")} ` +
              `${
                lifted.conflicts.length === 1 ? "is" : "are"
              } also set at the top level of system.yaml with a different value`,
          );
        } else if (
          added.outcome === "manual" || withConfig.outcome === "manual" || !nextSite.removed ||
          !nextSystemRemoved.removed
        ) {
          unresolvedFiles++;
          console.error(
            `  ✗ move the admin's settings by hand into the admin plugin's config: in site.yaml ` +
              `(plugins: is written in a way this command cannot extend, or the entry already has a config:)`,
          );
        } else {
          const nextSystem = lifted.text;
          changed++;
          const moved = Object.keys(plan.settings);
          console.log(
            `  ✓ moved the admin's settings into the admin plugin's config:` +
              (moved.length > 0 ? ` (${moved.join(", ")})` : "") +
              (Object.keys(plan.lifted).length > 0
                ? `; ${Object.keys(plan.lifted).join(", ")} now at the top level of system.yaml`
                : ""),
          );
          if (added.outcome === "added") {
            console.log(`  ✓ config/site.yaml: added ${ADMIN_PLUGIN_ENTRY_SRC} to plugins:`);
          }
          if (adminBlock !== undefined) await write(systemPath, nextSystem);
          await write(sitePath, nextSite.text);
        }
      }
    }
  } else if (siteText !== null && !adminWasDisabled) {
    const added = addAdminPluginToText(siteText);
    if (added.outcome === "added") {
      changed++;
      console.log(
        `  ✓ config/site.yaml: added ${ADMIN_PLUGIN_ENTRY_SRC} to plugins: (core no longer loads the admin by itself)`,
      );
      await write(sitePath, added.text);
    } else if (added.outcome === "manual") {
      unresolvedFiles++;
      console.error(
        `  ✗ config/site.yaml: add the admin by hand under plugins:\n        - src: ${ADMIN_PLUGIN_ENTRY_SRC}`,
      );
    }
    if (added.outcome === "added" && adminDisabledInOverlays.length > 0) {
      console.error(
        `  ⚠ ${
          adminDisabledInOverlays.join(", ")
        } set admin.enabled: false for that environment only. ` +
          `The admin is now listed in config/site.yaml and so loads in every environment; ` +
          `to keep it off in those, give that environment's site.yaml a plugins: list without the admin.`,
      );
    }
  }
  if (adminWasDisabled) {
    console.log(
      "  • admin.enabled was false: the admin plugin is not added. (Running this command again would add it.)",
    );
  }

  if (changed === 0 && unresolvedFiles === 0 && movedFiles === 0) {
    console.log("  Nothing to migrate — all config keys are already snake_case.");
  } else if (opts.dryRun && changed > 0) {
    console.log("\n  Dry run: nothing written. Re-run without --dry-run to apply.");
  }
  if (unresolvedFiles > 0 || movedFiles > 0) Deno.exit(1);
}
