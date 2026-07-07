/**
 * Detects whether an unused local workspace checkout of @dune/core exists.
 *
 * `deno run jsr:@dune/core/cli ...` only honors Deno workspace-linking for
 * the top-level entrypoint when an explicit `--config` names (an ancestor
 * of) the workspace root — ambient cwd-based discovery, which normally
 * makes workspace-linking "just work" for imports inside an already-loaded
 * graph, does not extend to entrypoint specifier resolution. Without
 * `--config`, this process is genuinely running the published package, and
 * every re-exec cli.ts/cli-impl.ts perform from here on stays locked to that
 * published version — there is no way back to local source later in the
 * process tree.
 *
 * This is invisible unless you know to look for it, so before locking into
 * "published" mode we check whether cwd sits under a workspace that would
 * have linked @dune/core locally had `--config` been passed, and warn if so.
 */

/** Maximum ancestor directories to walk looking for a workspace root. */
const MAX_WALK_UP = 12;

async function readJsonIfExists(path: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await Deno.readTextFile(path));
  } catch {
    return null;
  }
}

/**
 * Walk up from `startDir` looking for a deno.json/deno.jsonc with a
 * `"workspace"` array that includes a member whose own config declares
 * `"name": "@dune/core"`. Returns the absolute path to that member's
 * directory, or null if no such workspace is found.
 */
export async function findLocalDuneCoreCheckout(startDir: string): Promise<string | null> {
  let dir = startDir;
  for (let i = 0; i < MAX_WALK_UP; i++) {
    for (const filename of ["deno.json", "deno.jsonc"]) {
      const configPath = `${dir}/${filename}`;
      const config = await readJsonIfExists(configPath);
      const workspace = config?.workspace;
      if (!Array.isArray(workspace)) continue;

      for (const member of workspace) {
        if (typeof member !== "string") continue;
        const memberDir = `${dir}/${member}`.replace(/\/\.\//g, "/").replace(/\/+$/, "");
        for (const memberFilename of ["deno.json", "deno.jsonc"]) {
          const memberConfig = await readJsonIfExists(`${memberDir}/${memberFilename}`);
          if (memberConfig?.name === "@dune/core") {
            try {
              return await Deno.realPath(memberDir);
            } catch {
              return memberDir;
            }
          }
        }
      }
    }

    const parent = dir.replace(/\/[^/]+$/, "");
    if (parent === dir || parent === "") break;
    dir = parent;
  }
  return null;
}

/**
 * Print a one-time warning if this process is about to lock into running
 * the published @dune/core package while an unused local workspace checkout
 * sits on disk. No-op (and cheap) when no such checkout is found.
 */
export async function warnIfLocalCheckoutUnused(root: string): Promise<void> {
  const localPath = await findLocalDuneCoreCheckout(root).catch(() => null);
  if (!localPath) return;
  console.error(
    `[dune] Running the published @dune/core package (resolved via jsr:), ` +
      `not the local checkout at ${localPath}.\n` +
      `[dune] Deno only workspace-links a jsr: entrypoint when --config points at ` +
      `(an ancestor of) the workspace root — ambient discovery from cwd doesn't apply ` +
      `to the entrypoint itself.\n` +
      `[dune] To exercise local changes, either invoke the local file directly ` +
      `(deno run -A ${localPath}/src/cli.ts ...) or pass --config explicitly.`,
  );
}
