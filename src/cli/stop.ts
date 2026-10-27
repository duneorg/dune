/**
 * dune stop — stop dune dev/serve instances found by `dune ps`.
 *
 * A target is required: a PID (any process of an instance), `--port`, `--idle`
 * (only instances that are running but not listening, and not just starting)
 * or `--all`. A bare `dune stop` does nothing but print usage, so stopping
 * every server on a machine always has to be asked for by name.
 *
 * `--all` and `--idle` act only on *confirmed* instances (a `config/site.yaml`
 * was found at the site root): a command line that merely looks like dune
 * (`main.ts serve`) could be any Deno project, so those must be named by pid.
 * Only this user's processes are considered, and each pid's start time is
 * re-checked immediately before it is signalled, so a pid that exited and was
 * reused while the prompt was open is never hit.
 *
 * SIGTERM first, so a server can drain. A process that ignores it is reported,
 * and only `--force` escalates to SIGKILL (which can orphan a wrapper's child,
 * so it is not the default). Whole process trees are stopped, and this process
 * and its ancestors are never signalled.
 *
 * @module
 */

import { type DuneInstance, findDuneInstances, MissingPermissionError, readProcessTable, runCommand } from "./instances.ts";
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
  /** Pids that had already exited, or whose pid now belongs to a different process: not signalled. */
  changed: number[];
  /** Pids the operating system refused to signal (owned by another user). */
  denied: number[];
  /** Pids Deno's own permission system refused to signal (needs `--allow-run`). */
  needsPermission: number[];
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

/** Current start time of each of `pids` that still exists. */
async function currentStartTimes(pids: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (pids.length === 0) return out;
  const text = await runCommand("ps", ["-o", "pid=,lstart=", "-p", pids.join(",")]);
  for (const line of text?.split("\n") ?? []) {
    const m = line.match(/^\s*(\d+)\s+(.*\S)\s*$/);
    if (m) out.set(parseInt(m[1], 10), m[2].replace(/\s+/g, " "));
  }
  return out;
}

/**
 * Signal each pid that is still the same process it was when the instance was
 * found (same start time). Anything else is reported, not signalled: a pid
 * can be reused by an unrelated process while the confirmation prompt is open.
 */
async function signalVerified(
  pids: number[],
  expected: Map<number, string | undefined>,
  signal: Deno.Signal,
  sink: { changed: Set<number>; denied: Set<number>; needsPermission: Set<number> },
): Promise<void> {
  const now = await currentStartTimes(pids);
  for (const pid of pids) {
    const want = expected.get(pid);
    if (!want || now.get(pid) !== want) {
      sink.changed.add(pid);
      continue;
    }
    try {
      Deno.kill(pid, signal);
    } catch (err) {
      if (err instanceof Deno.errors.PermissionDenied) sink.denied.add(pid); // EPERM: someone else's
      else if (err instanceof Deno.errors.NotCapable) sink.needsPermission.add(pid); // Deno's permissions
      else sink.changed.add(pid); // already gone
    }
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
  const expected = new Map<number, string | undefined>();
  for (const inst of instances) for (const p of inst.pids) expected.set(p, inst.startTimes[p]);
  const sink = { changed: new Set<number>(), denied: new Set<number>(), needsPermission: new Set<number>() };

  await signalVerified(toSignal, expected, "SIGTERM", sink);
  const signalled = toSignal.filter((p) => !sink.changed.has(p) && !sink.denied.has(p) && !sink.needsPermission.has(p));
  const afterTerm = await waitUntilGone(signalled, timeoutMs);

  let survivors = afterTerm;
  let killed: number[] = [];
  if (opts.force && afterTerm.length > 0) {
    await signalVerified(afterTerm, expected, "SIGKILL", sink);
    const sent = afterTerm.filter((p) => !sink.changed.has(p) && !sink.denied.has(p) && !sink.needsPermission.has(p));
    const left = await waitUntilGone(sent, killTimeoutMs);
    survivors = afterTerm.filter((p) => left.includes(p) || sink.denied.has(p) || sink.needsPermission.has(p));
    killed = sent.filter((p) => !left.includes(p));
  }
  const gone = new Set(signalled.filter((p) => !survivors.includes(p)));
  return {
    stopped: signalled.filter((p) => gone.has(p)),
    killed,
    survivors,
    skipped,
    changed: [...sink.changed],
    denied: [...sink.denied],
    needsPermission: [...sink.needsPermission],
  };
}

// ── Choosing what to stop ────────────────────────────────────────────────────

export interface StopOptions {
  /** A PID: matches an instance by its topmost process or any of its children. */
  pid?: string;
  /** The instance listening on this port. */
  port?: string;
  /** Only instances that aren't serving: running but not listening, or listening but not responding (hung or leftover). */
  idle?: boolean;
  /** Every instance `dune ps` lists. */
  all?: boolean;
  /** Escalate to SIGKILL for processes that ignore SIGTERM. */
  force?: boolean;
  /** Skip the confirmation prompt. */
  yes?: boolean;
}

/** `--idle` leaves alone a not-listening instance younger than this: it may still be starting (indexing a big site takes a while). Matches the watchdog's startup limit. */
export const IDLE_MIN_AGE_SECONDS = 120;

export const STOP_USAGE = `Usage: dune stop <pid> | --port <n> | --idle | --all  [--force] [--yes]

  <pid>        the instance this process belongs to (see \`dune ps\`)
  --port <n>   the instance listening on that port
  --idle       only instances that aren't serving: running but not
               listening, or listening but not responding to a health
               check, for at least 2 minutes (younger ones may still
               be starting)
  --all        every confirmed instance \`dune ps\` lists
  --force      SIGKILL processes that ignore SIGTERM (default: report them)
  --yes, -y    don't ask for confirmation

Only your own processes are considered. \`--idle\` and \`--all\` act only on
instances confirmed as dune sites (a config/site.yaml at the site root); one
that only looks like dune by its command line must be named by pid. Stopping
an instance stops its whole process tree, including any other tool its
wrapper started.`;

export type Selection =
  | { ok: true; instances: DuneInstance[]; label: string; notes: string[] }
  | { ok: false; message: string; exitCode: number };

function parseNumber(value: string, what: string, max: number): number | string {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n <= max ? n : `"${value}" is not a valid ${what}.`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Pure: pick the instances `opts` asks for out of `all`, or explain why none. */
export function selectInstances(all: DuneInstance[], opts: StopOptions): Selection {
  const chosen = [opts.pid !== undefined, opts.port !== undefined, opts.idle === true, opts.all === true]
    .filter(Boolean).length;
  if (chosen === 0) return { ok: false, message: STOP_USAGE, exitCode: 2 };
  if (chosen > 1) {
    return { ok: false, message: `Choose one target: a pid, --port, --idle or --all.\n\n${STOP_USAGE}`, exitCode: 2 };
  }

  const unconfirmedNote = (found: DuneInstance[]): string[] =>
    found.some((i) => !i.confirmed)
      ? ["Not confirmed as a dune site: no config/site.yaml was found for it. It matches dune by its command line only."]
      : [];

  if (opts.pid !== undefined) {
    const pid = parseNumber(opts.pid, "pid", 4_194_304);
    if (typeof pid === "string") return { ok: false, message: pid, exitCode: 2 };
    const found = all.filter((i) => i.pids.includes(pid));
    if (found.length === 0) {
      return { ok: false, message: `No dune instance of yours has a process with pid ${pid}. \`dune ps\` lists them.`, exitCode: 1 };
    }
    return { ok: true, instances: found, label: "", notes: unconfirmedNote(found) };
  }

  if (opts.port !== undefined) {
    const port = parseNumber(opts.port, "port", 65_535);
    if (typeof port === "string") return { ok: false, message: port, exitCode: 2 };
    const found = all.filter((i) => i.ports.includes(port));
    if (found.length === 0) {
      return { ok: false, message: `No dune instance of yours is listening on port ${port}. \`dune ps\` lists them.`, exitCode: 1 };
    }
    return { ok: true, instances: found, label: "", notes: unconfirmedNote(found) };
  }

  // --all / --idle: confirmed instances only.
  const confirmed = all.filter((i) => i.confirmed);
  const notes: string[] = [];
  const skippedUnconfirmed = all.length - confirmed.length;
  if (skippedUnconfirmed > 0) {
    notes.push(
      `${plural(skippedUnconfirmed, "process that only looks", "processes that only look")} like dune by its command line ` +
        `(no config/site.yaml found) ${skippedUnconfirmed === 1 ? "was" : "were"} left out; stop ${skippedUnconfirmed === 1 ? "it" : "them"} by pid if intended.`,
    );
  }

  if (opts.idle) {
    const notServing = confirmed.filter((i) => i.portStatus === "not-listening" || i.responsive === "not-responding");
    const mature = notServing.filter((i) => i.ageSeconds === null || i.ageSeconds >= IDLE_MIN_AGE_SECONDS);
    const young = notServing.length - mature.length;
    if (young > 0) {
      notes.push(
        `${plural(young, "instance", "instances")} not serving yet ${young === 1 ? "was" : "were"} left out because ` +
          `${young === 1 ? "it is" : "they are"} under ${IDLE_MIN_AGE_SECONDS / 60} minutes old and may still be starting.`,
      );
    }
    const unknown = confirmed.filter((i) => i.portStatus === "unknown").length;
    if (mature.length === 0 && unknown > 0) {
      return {
        ok: false,
        message: "Can't tell which instances are idle: `lsof` isn't available, so no instance can be shown as not listening.",
        exitCode: 1,
      };
    }
    if (mature.length === 0) {
      const why = [...notes].map((n) => `\n  ${n}`).join("");
      return {
        ok: false,
        message: `No idle instances: ${confirmed.length === 0 ? "none of the running instances is a confirmed dune site" : `all ${confirmed.length} confirmed running instance${confirmed.length === 1 ? " is" : "s are"} listening and responding`}.${why}`,
        exitCode: 0,
      };
    }
    return { ok: true, instances: mature, label: "idle ", notes };
  }

  if (confirmed.length === 0) {
    return {
      ok: false,
      message: `None of the running instances is a confirmed dune site.${notes.map((n) => `\n  ${n}`).join("")}`,
      exitCode: 0,
    };
  }
  return { ok: true, instances: confirmed, label: "", notes };
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

  let all: DuneInstance[];
  try {
    all = await (deps.find ?? (() => findDuneInstances({ onWarning: (m) => log(`  ⚠  ${m}`) })))();
  } catch (err) {
    if (err instanceof MissingPermissionError) {
      log(`  ${err.message}`);
      Deno.exitCode = 1;
      return;
    }
    throw err;
  }
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

  const { instances, label, notes } = selection;
  log("");
  for (const inst of instances) for (const line of formatInstance(inst, { fullCommand: true })) log(line);
  for (const note of notes) log(`  Note: ${note}`);
  if (notes.length > 0) log("");

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
  if (result.changed.length > 0) {
    log(`  Not signalled (already exited, or the pid now belongs to a different process): ${result.changed.join(", ")}`);
  }
  if (result.denied.length > 0) {
    log(`  Not permitted (owned by another user): ${result.denied.join(", ")}`);
    Deno.exitCode = 1;
  }
  if (result.needsPermission.length > 0) {
    log(`  Not allowed by Deno's permissions (re-run with --allow-run, or -A): ${result.needsPermission.join(", ")}`);
    Deno.exitCode = 1;
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
