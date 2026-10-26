/**
 * dune stop — stop dune dev/serve instances found by `dune ps`.
 *
 * A target is required: a PID (any process of an instance), `--port`, `--idle`
 * (only instances that are running but not listening) or `--all`. A bare
 * `dune stop` does nothing but print usage, so stopping every server on a
 * machine always has to be asked for by name.
 *
 * SIGTERM first, so a server can drain. A process that ignores it is reported,
 * and only `--force` escalates to SIGKILL (which can orphan a wrapper's child,
 * so it is not the default). Whole process trees are stopped, and this process
 * and its ancestors are never signalled.
 *
 * @module
 */

import { type DuneInstance, findDuneInstances, readProcessTable, runCommand } from "./instances.ts";
import { formatInstance } from "./ps.ts";

// ── Signalling ───────────────────────────────────────────────────────────────

/** This process and its ancestors: never a stop target, whatever the caller passes. */
async function selfAndAncestors(): Promise<Set<number>> {
  const table = await readProcessTable();
  const byPid = new Map(table.map((r) => [r.pid, r]));
  const protectedPids = new Set<number>([Deno.pid]);
  let cur = byPid.get(Deno.pid)?.ppid;
  for (let i = 0; cur && cur > 1 && i < 64; i++) {
    protectedPids.add(cur);
    cur = byPid.get(cur)?.ppid;
  }
  return protectedPids;
}

export interface StopResult {
  /** Pids that were signalled and are gone (including those that needed SIGKILL). */
  stopped: number[];
  /** The subset of `stopped` that ignored SIGTERM for the whole grace period and was SIGKILLed (`force` only). */
  killed: number[];
  /** Pids still alive: they ignored SIGTERM (without `force`), or survived SIGKILL too. */
  survivors: number[];
  /** Pids deliberately not signalled (this process and its ancestors). */
  skipped: number[];
}

async function alivePids(pids: number[]): Promise<number[]> {
  if (pids.length === 0) return [];
  const out = await runCommand("ps", ["-o", "pid=", "-p", pids.join(",")]);
  if (!out) return [];
  const alive = new Set(out.split("\n").map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n)));
  return pids.filter((p) => alive.has(p));
}

async function waitUntilGone(pids: number[], timeoutMs: number): Promise<number[]> {
  const deadline = Date.now() + timeoutMs;
  let remaining = await alivePids(pids);
  while (remaining.length > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 150));
    remaining = await alivePids(remaining);
  }
  return remaining;
}

function signalAll(pids: number[], signal: Deno.Signal): void {
  for (const pid of pids) {
    try {
      Deno.kill(pid, signal);
    } catch { /* already gone */ }
  }
}

/**
 * Stop whole instance trees: SIGTERM, then wait up to `timeoutMs` for a
 * graceful exit. With `force`, whatever is still alive after that gets SIGKILL
 * (reported in `killed`); without it, those pids are returned as `survivors`.
 */
export async function stopInstances(
  instances: DuneInstance[],
  opts: { force?: boolean; timeoutMs?: number; killTimeoutMs?: number } = {},
): Promise<StopResult> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const killTimeoutMs = opts.killTimeoutMs ?? 2_000;
  const protectedPids = await selfAndAncestors();
  const targets = [...new Set(instances.flatMap((i) => i.pids))];
  const skipped = targets.filter((p) => protectedPids.has(p));
  const toSignal = targets.filter((p) => !protectedPids.has(p));

  signalAll(toSignal, "SIGTERM");
  const afterTerm = await waitUntilGone(toSignal, timeoutMs);

  let survivors = afterTerm;
  let killed: number[] = [];
  if (opts.force && afterTerm.length > 0) {
    signalAll(afterTerm, "SIGKILL");
    survivors = await waitUntilGone(afterTerm, killTimeoutMs);
    killed = afterTerm.filter((p) => !survivors.includes(p));
  }
  const gone = new Set(toSignal.filter((p) => !survivors.includes(p)));
  return { stopped: toSignal.filter((p) => gone.has(p)), killed, survivors, skipped };
}

// ── Choosing what to stop ────────────────────────────────────────────────────

export interface StopOptions {
  /** A PID: matches an instance by its topmost process or any of its children. */
  pid?: string;
  /** The instance listening on this port. */
  port?: string;
  /** Only instances that are running but not listening (hung or leftover). */
  idle?: boolean;
  /** Every instance `dune ps` lists. */
  all?: boolean;
  /** Escalate to SIGKILL for processes that ignore SIGTERM. */
  force?: boolean;
  /** Skip the confirmation prompt. */
  yes?: boolean;
}

export const STOP_USAGE = `Usage: dune stop <pid> | --port <n> | --idle | --all  [--force] [--yes]

  <pid>        the instance this process belongs to (see \`dune ps\`)
  --port <n>   the instance listening on that port
  --idle       only instances that are running but not listening
  --all        every instance \`dune ps\` lists
  --force      SIGKILL processes that ignore SIGTERM (default: report them)
  --yes, -y    don't ask for confirmation`;

export type Selection =
  | { ok: true; instances: DuneInstance[]; label: string }
  | { ok: false; message: string; exitCode: number };

function parseNumber(value: string, what: string, max: number): number | string {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n <= max ? n : `"${value}" is not a valid ${what}.`;
}

/** Pure: pick the instances `opts` asks for out of `all`, or explain why none. */
export function selectInstances(all: DuneInstance[], opts: StopOptions): Selection {
  const chosen = [opts.pid !== undefined, opts.port !== undefined, opts.idle === true, opts.all === true]
    .filter(Boolean).length;
  if (chosen === 0) return { ok: false, message: STOP_USAGE, exitCode: 2 };
  if (chosen > 1) {
    return { ok: false, message: `Choose one target: a pid, --port, --idle or --all.\n\n${STOP_USAGE}`, exitCode: 2 };
  }

  if (opts.pid !== undefined) {
    const pid = parseNumber(opts.pid, "pid", 4_194_304);
    if (typeof pid === "string") return { ok: false, message: pid, exitCode: 2 };
    const found = all.filter((i) => i.pids.includes(pid));
    if (found.length === 0) {
      return { ok: false, message: `No dune instance has a process with pid ${pid}. \`dune ps\` lists them.`, exitCode: 1 };
    }
    return { ok: true, instances: found, label: "" };
  }

  if (opts.port !== undefined) {
    const port = parseNumber(opts.port, "port", 65_535);
    if (typeof port === "string") return { ok: false, message: port, exitCode: 2 };
    const found = all.filter((i) => i.ports.includes(port));
    if (found.length === 0) {
      return { ok: false, message: `No dune instance is listening on port ${port}. \`dune ps\` lists them.`, exitCode: 1 };
    }
    return { ok: true, instances: found, label: "" };
  }

  if (opts.idle) {
    const idle = all.filter((i) => i.portStatus === "not-listening");
    const unknown = all.filter((i) => i.portStatus === "unknown").length;
    if (idle.length === 0 && unknown > 0) {
      return {
        ok: false,
        message: "Can't tell which instances are idle: `lsof` isn't available, so no instance can be shown as not listening.",
        exitCode: 1,
      };
    }
    if (idle.length === 0) {
      return {
        ok: false,
        message: `No idle instances: all ${all.length} running instance${all.length === 1 ? " is" : "s are"} listening.`,
        exitCode: 0,
      };
    }
    return { ok: true, instances: idle, label: "idle " };
  }

  return { ok: true, instances: all, label: "" };
}

// ── Command ──────────────────────────────────────────────────────────────────

/** Injection points so the command's flow is testable without touching real processes. */
export interface StopDeps {
  find?: () => Promise<DuneInstance[]>;
  stop?: typeof stopInstances;
  isInteractive?: () => boolean;
  confirm?: (message: string) => Promise<boolean>;
  log?: (line: string) => void;
}

export async function stopCommand(opts: StopOptions = {}, deps: StopDeps = {}): Promise<void> {
  const log = deps.log ?? ((l: string) => console.log(l));
  if (Deno.build.os === "windows") {
    log("  ⚠  `dune stop` needs `ps`/`lsof` and isn't supported on Windows yet.");
    return;
  }

  // Validate the request before scanning anything.
  const preliminary = selectInstances([], opts);
  if (!preliminary.ok && preliminary.exitCode === 2) {
    log(preliminary.message);
    Deno.exitCode = 2;
    return;
  }

  const all = await (deps.find ?? findDuneInstances)();
  if (all.length === 0) {
    log("  No dune dev/serve instances found running locally.");
    // Naming a pid or port that isn't there is a failure; --idle/--all with nothing to do is not.
    if (opts.pid !== undefined || opts.port !== undefined) Deno.exitCode = 1;
    return;
  }

  const selection = selectInstances(all, opts);
  if (!selection.ok) {
    log(`  ${selection.message}`);
    Deno.exitCode = selection.exitCode;
    return;
  }

  const { instances, label } = selection;
  log("");
  for (const inst of instances) for (const line of formatInstance(inst)) log(line);

  const procCount = new Set(instances.flatMap((i) => i.pids)).size;
  const question = `Stop ${instances.length} ${label}instance${instances.length === 1 ? "" : "s"} (${procCount} process${procCount === 1 ? "" : "es"})?`;
  if (!opts.yes) {
    const interactive = (deps.isInteractive ?? (() => Deno.stdin.isTerminal()))();
    if (!interactive) {
      log(`  Not stopping: ${question} needs confirmation, and this isn't a terminal. Re-run with --yes.`);
      Deno.exitCode = 1;
      return;
    }
    const ok = await (deps.confirm ?? ((m) => Promise.resolve(globalThis.confirm(m))))(question);
    if (!ok) {
      log("  Cancelled; nothing was stopped.");
      return;
    }
  }

  const result = await (deps.stop ?? stopInstances)(instances, { force: opts.force === true });
  log(`  Stopped ${result.stopped.length} process${result.stopped.length === 1 ? "" : "es"}.`);
  if (result.skipped.length > 0) {
    log(`  Left alone (this command's own process and its parents): ${result.skipped.join(", ")}`);
  }
  if (result.killed.length > 0) {
    log(`  ${result.killed.length} did not exit on SIGTERM and were killed (SIGKILL): ${result.killed.join(", ")}`);
  }
  if (result.survivors.length > 0) {
    if (opts.force) {
      log(`  Could not stop (still running even after SIGKILL): ${result.survivors.join(", ")}`);
    } else {
      log(`  Still running (ignored SIGTERM): ${result.survivors.join(", ")}\n  Re-run with --force to SIGKILL them.`);
    }
    Deno.exitCode = 1;
  }
}
