/**
 * `dune migrate:entrypoint` — move an existing site from the re-exec path
 * (global `dune` shim, or a `jsr:@dune/core@X.Y.Z/cli` re-exec) onto the
 * generated `main.ts` site-entrypoint pattern (plan-site-entrypoint.md).
 *
 * Ordering matters (per the migration runbook in plan-site-entrypoint.md):
 * write `main.ts` and merge import-map entries BEFORE rewriting `tasks` — a
 * site whose task definitions have been rewritten but whose `main.ts` isn't
 * in place yet is a down service.
 *
 * Deliberately does NOT typecheck main.ts against the site's resolved
 * `@dune/core` specifier as part of this step: that would require a network
 * fetch of whatever `@dune/core` version the site declares, and until a
 * release with the callable `cli()` export is actually published, that
 * fetch fails for every site, unconditionally — not a signal about this
 * particular migration. main.ts's own content is a fixed, separately-tested
 * template (see new_test.ts) with nothing site-specific to verify; the
 * import-map merge is pure data with no network dependency either. Real
 * end-to-end verification (does this site's specific plugin/theme set
 * actually run) is exactly what `dune validate` and the migration runbook's
 * "soak-test this site" step are for — run those after migrating, not as
 * part of this command.
 *
 * Idempotent: re-running against an already-migrated site is a no-op.
 * Refuses (does not overwrite) if `main.ts` exists with contents that don't
 * match the known template — that file is meant to be generated, never
 * hand-edited, and this is the enforcement of that contract.
 */

import { resolve, join } from "@std/path";
import {
  DUNE_CORE_RUNTIME_IMPORTS,
  ENTRYPOINT_MCP_ARGS,
  ENTRYPOINT_TASKS,
  MAIN_TS_TEMPLATE,
} from "./entrypoint-template.ts";

export interface MigrateEntrypointOptions {
  dryRun?: boolean;
}

export interface MigrateEntrypointResult {
  migrated: boolean;
  /** True when main.ts and tasks already matched the entrypoint pattern. */
  alreadyMigrated: boolean;
  addedImports: string[];
  rewroteTasks: boolean;
  rewroteMcpJson: boolean;
  /** Set when refusing to proceed — main.ts exists but doesn't match the template. */
  refusedReason?: string;
}

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await Deno.readTextFile(path));
  } catch {
    return null;
  }
}

/** Quote-aware whitespace tokenizer for a task's command string. */
function tokenize(cmd: string): string[] {
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  const tokens: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(cmd)) !== null) {
    tokens.push(m[1] ?? m[2] ?? m[3]);
  }
  return tokens;
}

/**
 * Extract any CLI args a site had customized on its old dev/build/serve task
 * (e.g. `--port 8080`, `--frozen`) so the migration preserves them instead of
 * silently dropping them when the task string is replaced wholesale. Finds
 * the last occurrence of the dune subcommand name (e.g. "serve") in the old
 * task's tokens and returns everything after it.
 */
function extractExtraArgs(oldTaskCmd: string | undefined, commandName: string): string[] {
  if (!oldTaskCmd) return [];
  const tokens = tokenize(oldTaskCmd);
  const idx = tokens.lastIndexOf(commandName);
  if (idx === -1) return [];
  return tokens.slice(idx + 1);
}

function tasksAlreadyMigrated(tasks: Record<string, unknown> | undefined): boolean {
  if (!tasks) return false;
  return ["dev", "build", "serve"].every((cmd) => {
    const value = tasks[cmd];
    return typeof value === "string" && value.includes("main.ts");
  });
}

export async function migrateEntrypointCommand(
  root: string,
  opts: MigrateEntrypointOptions = {},
): Promise<MigrateEntrypointResult> {
  const absRoot = resolve(root);
  const denoJsonPath = join(absRoot, "deno.json");
  const mainTsPath = join(absRoot, "main.ts");
  const mcpJsonPath = join(absRoot, ".mcp.json");

  const denoJson = await readJson(denoJsonPath);
  if (!denoJson) {
    console.error(`  ✗ No deno.json found at ${denoJsonPath}`);
    Deno.exit(1);
  }

  const existingMainTs = await Deno.readTextFile(mainTsPath).catch(() => null);
  const tasks = (denoJson.tasks as Record<string, unknown> | undefined) ?? {};

  if (existingMainTs === MAIN_TS_TEMPLATE && tasksAlreadyMigrated(tasks)) {
    console.log(`  ✅ ${absRoot} already uses the main.ts entrypoint pattern — nothing to do.`);
    return { migrated: false, alreadyMigrated: true, addedImports: [], rewroteTasks: false, rewroteMcpJson: false };
  }

  if (existingMainTs !== null && existingMainTs !== MAIN_TS_TEMPLATE) {
    const reason =
      `main.ts exists at ${mainTsPath} but its contents don't match the generated ` +
      `template. Refusing to overwrite it — main.ts is meant to be generated, not ` +
      `hand-edited. Compare it against the template (dune new's scaffold produces the ` +
      `current version) and reconcile manually before re-running this command.`;
    console.error(`  ✗ ${reason}`);
    return {
      migrated: false,
      alreadyMigrated: false,
      addedImports: [],
      rewroteTasks: false,
      rewroteMcpJson: false,
      refusedReason: reason,
    };
  }

  // ── Step 1: compute the import-map additions (validate before writing) ──────
  const imports = { ...(denoJson.imports as Record<string, string> | undefined ?? {}) };
  const addedImports: string[] = [];
  for (const [key, value] of Object.entries(DUNE_CORE_RUNTIME_IMPORTS)) {
    if (!(key in imports)) {
      imports[key] = value;
      addedImports.push(key);
    }
  }

  if (opts.dryRun) {
    console.log(`  Would write main.ts at ${mainTsPath}`);
    if (addedImports.length > 0) {
      console.log(`  Would add ${addedImports.length} import map entr${addedImports.length === 1 ? "y" : "ies"}:`);
      for (const key of addedImports) console.log(`    + ${key}`);
    }
    console.log(`  Would rewrite tasks (dev/build/serve) to invoke main.ts`);
    console.log(`  Would rewrite .mcp.json to invoke main.ts`);
    return { migrated: false, alreadyMigrated: false, addedImports, rewroteTasks: false, rewroteMcpJson: false };
  }

  // ── Step 2: write main.ts and merge imports BEFORE touching tasks ────────────
  await Deno.writeTextFile(mainTsPath, MAIN_TS_TEMPLATE);

  // ── Step 3: main.ts is in place — now it's safe to rewrite tasks ─────────────
  // Preserve any flags the site had customized on the old task (e.g. a
  // non-default --port, --frozen) instead of clobbering them with the bare
  // template — see extractExtraArgs.
  const newTasks = { ...tasks };
  for (const [commandName, template] of Object.entries(ENTRYPOINT_TASKS)) {
    const oldValue = typeof tasks[commandName] === "string" ? tasks[commandName] as string : undefined;
    const extraArgs = extractExtraArgs(oldValue, commandName);
    newTasks[commandName] = extraArgs.length > 0 ? `${template} ${extraArgs.join(" ")}` : template;
  }
  await Deno.writeTextFile(
    denoJsonPath,
    JSON.stringify({ ...denoJson, imports, tasks: newTasks }, null, 2) + "\n",
  );

  let rewroteMcpJson = false;
  const mcpJson = await readJson(mcpJsonPath);
  if (mcpJson) {
    const servers = mcpJson.mcpServers as Record<string, { args?: string[] }> | undefined;
    if (servers?.dune) {
      servers.dune.args = ENTRYPOINT_MCP_ARGS;
      await Deno.writeTextFile(mcpJsonPath, JSON.stringify(mcpJson, null, 2) + "\n");
      rewroteMcpJson = true;
    }
  }

  console.log(`  ✅ ${absRoot} migrated to the main.ts entrypoint pattern.`);
  if (addedImports.length > 0) {
    console.log(`     Added ${addedImports.length} import map entr${addedImports.length === 1 ? "y" : "ies"}:`);
    for (const key of addedImports) console.log(`       + ${key}`);
  }
  console.log(`     Rewrote tasks: dev, build, serve`);
  if (rewroteMcpJson) console.log(`     Rewrote .mcp.json`);
  console.log(`\n  This cutover is one commit — rollback is \`git revert\` + restart.`);
  console.log(`  Soak-test this site before migrating the rest of the fleet.\n`);

  return { migrated: true, alreadyMigrated: false, addedImports, rewroteTasks: true, rewroteMcpJson };
}
