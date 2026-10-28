/**
 * Event-loop watchdog.
 *
 * A synchronous loop (catastrophic regex backtracking, a conversion that never
 * terminates) blocks the one thread that serves every request, so one bad
 * request takes the whole site down — silently, with nothing in the logs, and
 * only a restart clears it. A blocked thread can't rescue itself, so the check
 * runs on a separate one: the main thread posts a heartbeat to a Worker every
 * second, and the Worker acts when the heartbeats stop.
 *
 * What it does on a stall (`DUNE_WATCHDOG`):
 *   - `exit` (default): write a report (plus a native stack sample where
 *     `sample` exists) to `<root>/.dune/hangs/`, then SIGKILL the process so a
 *     supervisor (systemd `Restart=`, the `dune dev` wrapper's exit) sees a
 *     dead process instead of a zombie. SIGKILL, not `Deno.exit()`: an exit
 *     requested from a worker only ends the worker; the spinning main thread
 *     carries on. The kill always happens: writing the report is raced against
 *     a timeout.
 *   - `warn`: same report, no kill. Used automatically when an inspector flag
 *     (`--inspect`, `--inspect-brk`, ...) is present, because a breakpoint
 *     pauses only the main thread and would otherwise look like a hang.
 *   - `off`: nothing starts.
 *
 * It measures a lack of *progress*, not of idleness, and it cannot tell an
 * infinite loop from a long computation by looking at the thread. Work that is
 * legitimately synchronous says so:
 *   - `watchdogProgress()`, called per item inside a long synchronous loop,
 *     counts as a heartbeat (rate-limited, so calling it 10k times is cheap).
 *     It only protects loops that call it: an unbounded loop that calls it on
 *     every iteration looks alive forever. Most indexing/compile loops are
 *     async and yield anyway; only genuinely synchronous ones need it.
 *   - `watchdogGrace(ms, reason)` declares an expected-busy window for work
 *     where per-item progress can't be reported (one long native call). It is
 *     capped, auto-expires, nests, and is logged when used.
 *
 * Two further guards against false kills: the stall clock is monotonic
 * (`performance.now()`), and the Worker treats a tick of its own that ran
 * late as "the whole process was suspended" (laptop sleep, Ctrl-Z / SIGSTOP)
 * and resets rather than fires. Until the server reports `ready()` the limit
 * is the much longer startup limit, so a big site's initial indexing can't
 * put a supervised process into a kill/restart loop.
 *
 * The main thread also logs a one-line warning when its own timer ran over a
 * second late, which makes a creeping problem visible before it becomes a
 * hang.
 *
 * @module
 */

export type WatchdogMode = "exit" | "warn" | "off";

export interface WatchdogOptions {
  /** Site root; reports go to `<root>/.dune/hangs/`. */
  root: string;
  /** What to do on a stall. Default: `DUNE_WATCHDOG` env, else `exit` (`warn` under an inspector). */
  mode?: WatchdogMode;
  /** Heartbeat silence that counts as a stall once ready. Default: `DUNE_WATCHDOG_TIMEOUT_MS` env, else 15000. */
  stallMs?: number;
  /** The limit before `ready()` is called. Default: `DUNE_WATCHDOG_STARTUP_TIMEOUT_MS` env, else 120000. */
  startupStallMs?: number;
  /** Heartbeat period. Default 1000; tests shorten it. */
  heartbeatMs?: number;
  /** Event-loop delay (over the expected tick) that logs a warning. Default 1000. */
  lagWarnMs?: number;
  /** Shown in the report and log line, e.g. `dev` / `serve`. */
  label?: string;
  /** How long writing the report may take before the kill goes ahead anyway. Default 5000; tests shorten it. */
  reportTimeoutMs?: number;
}

export interface Watchdog {
  /** The server is up: switch from the startup limit to the normal one. */
  ready(): void;
  stop(): void;
}

const DEFAULT_STALL_MS = 15_000;
const DEFAULT_STARTUP_STALL_MS = 120_000;
const DEFAULT_HEARTBEAT_MS = 1_000;
const DEFAULT_LAG_WARN_MS = 1_000;
/** `watchdogProgress()` posts at most this often. */
const PROGRESS_MIN_INTERVAL_MS = 250;
/** No grace window may be longer than this, whatever the caller asks. */
export const MAX_GRACE_MS = 10 * 60_000;
/** Reports kept in `.dune/hangs/`; older ones are deleted. */
const MAX_REPORTS = 20;
/** Writing the report must not be able to stop the kill. */
const REPORT_TIMEOUT_MS = 5_000;

// The running watchdog's Worker, so request middleware can report to it.
let activeWorker: Worker | null = null;
let nextId = 0;
let lastProgressPost = 0;

/**
 * Hide anything token-shaped before a request path goes into a report: any
 * path segment longer than 24 characters is cut to its first six.
 */
export function maskPath(path: string): string {
  return path.split("/").map((seg) => (seg.length > 24 ? `${seg.slice(0, 6)}…` : seg)).join("/");
}

/**
 * Record a request as in flight; call the returned function when it
 * finishes. A stall report then lists what was running, which is usually
 * the answer to "what hung?" — the native stack sample has no JS frames. A
 * no-op when no watchdog is running.
 */
export function trackRequest(method: string, path: string): () => void {
  const worker = activeWorker;
  if (!worker) return () => {};
  const id = ++nextId;
  worker.postMessage({ type: "req+", id, desc: `${method} ${maskPath(path)}` });
  return () => worker.postMessage({ type: "req-", id });
}

/**
 * Report progress from inside a long synchronous loop: counts as a heartbeat.
 * Cheap and rate-limited; a no-op when no watchdog is running. Call it once
 * per item, never in a loop that has no natural end.
 */
export function watchdogProgress(): void {
  const worker = activeWorker;
  if (!worker) return;
  const now = performance.now();
  if (now - lastProgressPost < PROGRESS_MIN_INTERVAL_MS) return;
  lastProgressPost = now;
  worker.postMessage({ type: "beat" });
}

/**
 * Declare that the process is expected to be busy for up to `ms` (capped at
 * `MAX_GRACE_MS`): the stall check pauses until the returned function is
 * called or the window expires, whichever is first. Windows nest. Use it only
 * for work that cannot report progress per item; it is logged each time.
 */
export function watchdogGrace(ms: number, reason: string): () => void {
  const worker = activeWorker;
  if (!worker) return () => {};
  const capped = Math.max(0, Math.min(ms, MAX_GRACE_MS));
  const id = ++nextId;
  console.warn(`[dune] watchdog: grace for "${reason}" (up to ${Math.round(capped / 1000)}s)`);
  worker.postMessage({ type: "grace+", id, ms: capped });
  return () => worker.postMessage({ type: "grace-", id });
}

/** Parse `DUNE_WATCHDOG`; anything unrecognised falls back to the default. */
export function parseWatchdogMode(value: string | undefined): WatchdogMode {
  const v = value?.trim().toLowerCase();
  return v === "off" || v === "warn" || v === "exit" ? v : "exit";
}

function parseMs(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1000 ? n : fallback;
}

/** Was this process started with an inspector flag? (`Deno.args` only has script args, so ask `ps`.) */
export function inspectorAttached(): boolean {
  if (Deno.build.os === "windows") return false;
  try {
    const out = new Deno.Command("ps", {
      args: ["-o", "args=", "-p", String(Deno.pid)],
      stdout: "piped",
      stderr: "null",
    }).outputSync();
    return /(^|\s)--inspect(-brk|-wait)?([=\s]|$)/.test(new TextDecoder().decode(out.stdout));
  } catch {
    return false;
  }
}

// Runs in the Worker. Kept as a string so it works from any module origin
// (jsr:/https: included), where a relative worker URL would not.
const WORKER_SOURCE = `
let cfg = null;
let last = performance.now();
let lastTick = performance.now();
let fired = false;
let ready = false;
const TICK_MS = 500;
const inflight = new Map();   // id -> { desc, since }
const graces = new Map();     // id -> expiry (performance.now() ms)
const pad = (n) => String(n).padStart(2, "0");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function prune(dir) {
  try {
    const names = [];
    for await (const e of Deno.readDir(dir)) if (/^hang-.*\\.txt$/.test(e.name) && !e.name.endsWith(".sample.txt")) names.push(e.name);
    names.sort();
    for (const n of names.slice(0, Math.max(0, names.length - cfg.maxReports))) {
      const base = n.slice(0, -4);
      await Deno.remove(dir + "/" + n).catch(() => {});
      await Deno.remove(dir + "/" + base + ".sample.txt").catch(() => {});
    }
  } catch { /* retention is best effort */ }
}

async function report(silentMs) {
  const now = new Date();
  const stamp = now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) +
    "-" + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
  const dir = cfg.root + "/.dune/hangs";
  const base = dir + "/hang-" + stamp + "-" + cfg.pid;
  const lines = [
    "Dune event-loop watchdog report",
    "time:     " + now.toISOString(),
    "pid:      " + cfg.pid,
    "command:  " + cfg.label,
    "root:     " + cfg.root,
    "deno:     " + Deno.version.deno,
    "uptime:   " + Math.round((performance.now() - cfg.startedAt) / 1000) + "s",
    "phase:    " + (ready ? "serving" : "startup"),
    "stalled:  main thread silent for " + Math.round(silentMs / 1000) + "s (limit " +
      Math.round(limit() / 1000) + "s)",
    "action:   " + (cfg.mode === "exit" ? "SIGKILL" : "none (DUNE_WATCHDOG=warn)"),
  ];
  const nowMs = performance.now();
  const pending = [...inflight.values()].sort((a, b) => a.since - b.since);
  lines.push("in-flight requests: " + pending.length);
  for (const r of pending.slice(0, 20)) {
    lines.push("  " + r.desc + "  (" + Math.round((nowMs - r.since) / 1000) + "s)");
  }
  let sampled = false;
  try {
    await Deno.mkdir(dir, { recursive: true });
    if (Deno.build.os === "darwin") {
      // 'sample' ships with macOS; it reads the stuck thread's native stack.
      const out = await new Deno.Command("sample", {
        args: [String(cfg.pid), "1", "-file", base + ".sample.txt"],
        stdout: "null",
        stderr: "null",
      }).output();
      sampled = out.success;
    }
    if (sampled) lines.push("sample:   " + base + ".sample.txt");
    else lines.push("sample:   unavailable on this platform; run 'eu-stack -p " + cfg.pid + "' or 'gdb -p " + cfg.pid + "' next time before killing");
    await Deno.writeTextFile(base + ".txt", lines.join("\\n") + "\\n");
    lines.push("report:   " + base + ".txt");
    await prune(dir);
  } catch (err) {
    lines.push("report:   could not be written (" + err + ")");
  }
  return lines;
}

function limit() {
  return ready ? cfg.stallMs : cfg.startupStallMs;
}

function graceActive(t) {
  for (const [id, expiry] of graces) {
    if (expiry <= t) graces.delete(id);
  }
  return graces.size > 0;
}

async function onStall(silent) {
  console.error("[dune] watchdog: the main thread has not responded for " +
    Math.round(silent / 1000) + "s (event loop blocked)");
  // The kill must not depend on the report: a hung 'sample', a slow or
  // network filesystem, or a failing mkdir would otherwise leave the process
  // running forever.
  const lines = await Promise.race([report(silent), sleep(cfg.reportTimeoutMs).then(() => null)]);
  if (lines === null) {
    console.error("[dune] watchdog: the report did not finish within " + Math.round(cfg.reportTimeoutMs / 1000) + "s");
  } else {
    for (const l of lines.filter((l) => /^(in-flight|  [A-Z]+ |sample|report)/.test(l))) {
      console.error("[dune] watchdog: " + l.trim());
    }
  }
  if (cfg.mode === "exit") {
    console.error("[dune] watchdog: killing pid " + cfg.pid + " so it can be restarted");
    try {
      Deno.kill(cfg.pid, "SIGKILL");
      return;
    } catch (err) {
      // Typically a missing --allow-run. Say so, and fall back to reporting
      // only: silently never firing again would be the worst outcome.
      console.error("[dune] watchdog: could not kill pid " + cfg.pid + " (" + err + "); " +
        "continuing in warn mode");
      cfg.mode = "warn";
    }
  }
  fired = false;   // keep watching, and report again if it stays stuck
  last = performance.now();
}

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === "init") {
    cfg = msg;
    last = lastTick = performance.now();
    setInterval(() => {
      const t = performance.now();
      const gap = t - lastTick;
      lastTick = t;
      // Our own timer ran far later than scheduled: the whole process was
      // suspended (sleep, SIGSTOP/Ctrl-Z). The main thread could not have
      // beaten us to the next heartbeat, so forget the gap.
      if (gap > TICK_MS * 2) { last = t; return; }
      const silent = t - last;
      if (fired || silent < limit() || graceActive(t)) return;
      fired = true;
      onStall(silent);
    }, TICK_MS);
  } else if (msg.type === "beat") {
    last = performance.now();
  } else if (msg.type === "ready") {
    ready = true;
    last = performance.now();
  } else if (msg.type === "req+") {
    inflight.set(msg.id, { desc: msg.desc, since: performance.now() });
  } else if (msg.type === "req-") {
    inflight.delete(msg.id);
  } else if (msg.type === "grace+") {
    graces.set(msg.id, performance.now() + msg.ms);
  } else if (msg.type === "grace-") {
    graces.delete(msg.id);
    last = performance.now();
  }
};
`;

/**
 * Start the watchdog for this process. Returns a handle whose `stop()` ends
 * it; a no-op handle when the mode is `off`.
 */
export function startWatchdog(opts: WatchdogOptions): Watchdog {
  let mode = opts.mode ?? parseWatchdogMode(Deno.env.get("DUNE_WATCHDOG"));
  if (mode === "off") return { ready() {}, stop() {} };
  if (mode === "exit" && opts.mode === undefined && Deno.env.get("DUNE_WATCHDOG") === undefined && inspectorAttached()) {
    console.warn("[dune] watchdog: inspector detected, reporting stalls instead of killing (DUNE_WATCHDOG=warn)");
    mode = "warn";
  }

  const stallMs = opts.stallMs ?? parseMs(Deno.env.get("DUNE_WATCHDOG_TIMEOUT_MS"), DEFAULT_STALL_MS);
  const startupStallMs = Math.max(
    stallMs,
    opts.startupStallMs ?? parseMs(Deno.env.get("DUNE_WATCHDOG_STARTUP_TIMEOUT_MS"), DEFAULT_STARTUP_STALL_MS),
  );
  const heartbeatMs = opts.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const lagWarnMs = opts.lagWarnMs ?? DEFAULT_LAG_WARN_MS;

  const url = URL.createObjectURL(
    new Blob([WORKER_SOURCE], { type: "application/javascript" }),
  );
  // Never revoke `url`: Deno loads a module worker's source asynchronously,
  // so revoking right after construction races the load and kills the
  // process at boot ("Module not found blob:null/..."). One small blob per
  // process lifetime is harmless.
  const worker = new Worker(url, { type: "module" });
  activeWorker = worker;
  worker.postMessage({
    type: "init",
    mode,
    stallMs,
    startupStallMs,
    root: opts.root,
    pid: Deno.pid,
    label: opts.label ?? "dune",
    startedAt: performance.now(),
    maxReports: MAX_REPORTS,
    reportTimeoutMs: opts.reportTimeoutMs ?? REPORT_TIMEOUT_MS,
  });

  let expected = performance.now() + heartbeatMs;
  const timer = setInterval(() => {
    const now = performance.now();
    const lag = now - expected;
    expected = now + heartbeatMs;
    worker.postMessage({ type: "beat" });
    if (lag >= lagWarnMs) {
      console.warn(`[dune] event loop was blocked for ~${(lag / 1000).toFixed(1)}s`);
    }
  }, heartbeatMs);
  // The heartbeat must not be what keeps a finished process alive.
  Deno.unrefTimer(timer);

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (activeWorker === worker) activeWorker = null;
    clearInterval(timer);
    worker.terminate();
  };
  // Unlike a timer, a Worker cannot be unref'd: it keeps the process alive
  // until terminated. Every normal exit path (`dune serve`'s graceful
  // shutdown) must therefore call stop(); signal-driven and Deno.exit()
  // exits end the process regardless. 'unload' is a best-effort backstop.
  globalThis.addEventListener("unload", stop);
  // A worker that fails to load or throws must not take the process down: an
  // unhandled worker error exits it. Degrade to "no watchdog" instead.
  worker.addEventListener("error", (e) => {
    e.preventDefault();
    console.error(`[dune] watchdog: worker failed (${e.message}); watchdog disabled`);
    stop();
  });
  return {
    ready: () => {
      if (!stopped) worker.postMessage({ type: "ready" });
    },
    stop,
  };
}
