/**
 * Defer to a site's own entrypoint.
 *
 * A site on the generated `main.ts` pattern governs itself: its import map
 * pins the core version, its `deno task`s carry the flags it wants
 * (`--watch`, `--env-file`), and `main.ts` is the one way it runs. A global
 * `dune dev` that re-execs its own copy of the CLI ignores all of that and
 * silently runs different code than `deno task dev` (a different core, local
 * plugin checkouts, no `.env`). So when the root holds an unedited template
 * `main.ts`, `dune <cmd> [args]` hands over to the site:
 *
 *   - the site has a task named `<cmd>` that runs `main.ts`
 *       → `deno task <cmd> [args]` (identical to what the site's own tasks do)
 *   - otherwise → `deno run -A main.ts <cmd> [args]`
 *
 * Escape hatch for working on Dune itself against a site: set
 * `DUNE_SITE_ENTRYPOINT=off`.
 *
 * This module is imported by the dependency-free shim (`cli.ts`), so it must
 * only use Deno APIs and sibling modules with no bare-specifier imports.
 *
 * @module
 */

import { MAIN_TS_TEMPLATE } from "./entrypoint-template.ts";
import { parseRootArg } from "./lock-policy.ts";

/** Commands that are about the dune install or the machine, not about running the site. */
const NOT_DEFERRED = new Set([
  "new",
  "ps",
  "stop",
  "dev:link",
  "upgrade",
  "lockfile:check",
  "lockfile:sync",
  "migrate:entrypoint",
]);

export interface SiteEntrypointPlan {
  /** Arguments for `deno`. */
  denoArgs: string[];
  /** Working directory for the spawned deno. */
  cwd: string;
  /** One-line human description, e.g. `deno task dev`. */
  description: string;
}

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await Deno.readTextFile(path));
  } catch {
    return null;
  }
}

function taskCommand(task: unknown): string | null {
  if (typeof task === "string") return task;
  if (task && typeof task === "object") {
    const command = (task as { command?: unknown }).command;
    if (typeof command === "string") return command;
  }
  return null;
}

/**
 * Decide whether `dune <args>` should hand over to the site's own entrypoint.
 * Returns `null` to carry on with the normal CLI.
 */
export async function planSiteEntrypoint(
  args: string[],
  env: { get(name: string): string | undefined } = Deno.env,
): Promise<SiteEntrypointPlan | null> {
  const command = args[0];
  if (!command || command.startsWith("-") || NOT_DEFERRED.has(command)) return null;
  if (env.get("DUNE_SITE_ENTRYPOINT") === "off") return null;
  // A task that itself runs `dune …` must not hand back to us in a loop.
  if (env.get("DUNE_VIA_SITE_ENTRYPOINT")) return null;

  let root: string;
  try {
    root = await Deno.realPath(parseRootArg(args));
  } catch {
    return null;
  }

  const mainTs = await Deno.readTextFile(`${root}/main.ts`).catch(() => null);
  if (mainTs !== MAIN_TS_TEMPLATE) return null;
  const denoJson = await readJson(`${root}/deno.json`);
  if (!denoJson) return null;

  // main.ts passes the site's own directory as the root, and the spawn runs
  // from there, so a caller-relative --root would now point somewhere else.
  const rest: string[] = [];
  const tail = args.slice(1);
  for (let i = 0; i < tail.length; i++) {
    if (tail[i] === "--root") {
      i++;
    } else if (!tail[i].startsWith("--root=")) {
      rest.push(tail[i]);
    }
  }
  const tasks = (denoJson.tasks ?? {}) as Record<string, unknown>;
  const existing = taskCommand(tasks[command]);
  if (existing !== null && existing.includes("main.ts")) {
    return {
      denoArgs: ["task", command, ...rest],
      cwd: root,
      description: `deno task ${command}`,
    };
  }
  return {
    denoArgs: ["run", "-A", "main.ts", command, ...rest],
    cwd: root,
    description: `deno run -A main.ts ${command}`,
  };
}
