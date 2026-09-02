/**
 * Deno-level lockfile policy for the CLI's re-exec child processes.
 *
 * Both re-exec mechanisms (local source in cli.ts, remote/JSR in cli-impl.ts)
 * reconstruct a child `deno run` invocation, and Deno-level `--lock`/`--frozen`
 * flags on the *outer* process never survive that reconstruction — Deno gives
 * a script no way to introspect its own CLI flags. Lockfile behavior must
 * therefore be expressed at the dune level (CLI arg or env var) and rendered
 * into the child's args here. Worse, the remote re-exec's `--config=<site>`
 * child used to auto-discover the site's deno.lock and rewrite it, unfrozen,
 * as a side effect of resolving its module graph — the "silently dirties
 * deno.lock on a server" failure described in lockfile.ts.
 *
 * There are deliberately only two modes:
 *
 *  - "frozen": the child runs with `--lock=<effective> --frozen` — real Deno
 *    enforcement, fails closed on a missing or stale lockfile.
 *  - "none": the child runs with `--no-lock` — it neither reads nor writes
 *    any lockfile.
 *
 * "Lock but unfrozen" is not offered: a running dune process implicitly
 * rewriting the lockfile is exactly what `dune lockfile:sync` exists to
 * prevent. `sync` is the only writer.
 *
 * `serve` does NOT default to frozen. It did briefly (0.29.0) but that
 * shipped a live regression: the built-in admin plugin is loaded via a
 * variable-argument dynamic import (deliberately, to break the
 * core<->plugin-admin publish cycle — see plugins/builtin.ts), and Deno's
 * `--frozen` validation, at least as observed on 2.7.14, refuses to boot
 * against a lockfile containing entries only reachable through that import —
 * even a lockfile `dune lockfile:sync` reports as complete. Confirmed not to
 * be a generic "frozen + dynamic import" limitation (a minimal isolated case
 * with a pure-JSR dynamic import boots fine); reproducible specifically with
 * Dune's actual graph, most likely implicating Deno's npm dependency
 * hoisting being computed globally rather than scoped to what's statically
 * reachable. Root cause is unresolved; frozen enforcement stays opt-in until
 * it is. See claudedocs/plan-site-entrypoint.md and its sibling docs for the
 * full investigation.
 *
 * Decision table (flags win over DUNE_FROZEN, which wins over the default):
 *
 *  | command                       | default | override                        |
 *  |-------------------------------|---------|---------------------------------|
 *  | lockfile:check, lockfile:sync | none    | (none — they scope their own    |
 *  |                               |         | subprocess lockfiles)           |
 *  | everything else (incl. serve) | none    | --frozen / DUNE_FROZEN=1        |
 *
 * This module is part of cli.ts's zero-external-dependency closure — keep it
 * free of bare specifiers.
 */

export type LockPolicy =
  | { mode: "frozen"; lockPath: string }
  | { mode: "none" };

/** Commands that manage their own subprocess lockfile scoping and must never
 * have a lockfile attached to their own process (see lockfile.ts's
 * `readPristineLockfileText` for why). */
const SELF_SCOPED_COMMANDS = new Set(["lockfile:check", "lockfile:sync"]);

/** Extract the --root value from CLI args (mirrors cli-impl.ts parsing). */
export function parseRootArg(args: string[]): string {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root" && args[i + 1]) return args[i + 1];
    if (args[i].startsWith("--root=")) return args[i].slice("--root=".length);
  }
  return ".";
}

async function readJsonIfExists(path: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await Deno.readTextFile(path));
  } catch {
    return null;
  }
}

/**
 * Find the directory whose `deno.lock` governs `root`: the nearest ancestor
 * (including `root` itself) whose `deno.json` declares a `"workspace"`,
 * falling back to `root` — the same semantics as `findEffectiveLockfileDir`
 * in lockfile.ts, duplicated here without the `@std/path` dependency to keep
 * this module inside cli.ts's dep-free closure.
 */
export async function findEffectiveLockfileDir(root: string): Promise<string> {
  let start: string;
  try {
    start = await Deno.realPath(root);
  } catch {
    return root;
  }
  let dir = start;
  for (let i = 0; i < 8; i++) {
    const config = await readJsonIfExists(`${dir}/deno.json`);
    if (config?.workspace) return dir;
    const parent = dir.replace(/\/[^/]+$/, "");
    if (parent === dir || parent === "") break;
    dir = parent;
  }
  return start;
}

/** Decide the lockfile policy for this invocation per the table above. */
export async function computeLockPolicy(
  args: string[],
  env: { get(key: string): string | undefined } = Deno.env,
): Promise<LockPolicy> {
  const command = args[0] ?? "";
  if (SELF_SCOPED_COMMANDS.has(command)) return { mode: "none" };

  let frozen = false;
  const envOverride = env.get("DUNE_FROZEN");
  if (envOverride === "1") frozen = true;
  else if (envOverride === "0") frozen = false;
  for (const arg of args) {
    if (arg === "--frozen") frozen = true;
    else if (arg === "--no-frozen") frozen = false;
  }
  if (!frozen) return { mode: "none" };

  const lockDir = await findEffectiveLockfileDir(parseRootArg(args));
  return { mode: "frozen", lockPath: `${lockDir}/deno.lock` };
}

/** Render the policy as Deno CLI flags for a re-exec child's args list. */
export function lockPolicyToArgs(policy: LockPolicy): string[] {
  return policy.mode === "frozen"
    ? [`--lock=${policy.lockPath}`, "--frozen"]
    : ["--no-lock"];
}

/**
 * Fail-fast check before spawning a frozen child: a missing lockfile would
 * fail anyway (Deno's `--frozen` errors on it), but with a message about
 * updating the lockfile rather than about the site never having synced one.
 * Returns an actionable error message, or null when the policy is satisfiable.
 *
 * Deliberately checks only *existence* — staleness is left to Deno's own
 * `--frozen` error, which prints the exact diff of what's missing.
 */
export async function preflightLockPolicy(policy: LockPolicy): Promise<string | null> {
  if (policy.mode !== "frozen") return null;
  try {
    await Deno.stat(policy.lockPath);
    return null;
  } catch {
    return (
      `[dune] Lockfile enforcement (--frozen) is on, but no lockfile exists at ${policy.lockPath}.\n` +
      `[dune] Run \`dune lockfile:sync\` in your site checkout, commit deno.lock, and redeploy.\n` +
      `[dune] To run without lockfile enforcement, pass --no-frozen or set DUNE_FROZEN=0.`
    );
  }
}
