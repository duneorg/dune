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
 *     carries on.
 *   - `warn`: same report, no kill.
 *   - `off`: nothing starts.
 *
 * The main thread also notices its own timer drift and logs a one-line warning
 * when the loop was held for over a second, which makes a creeping problem
 * visible before it becomes a hang.
 *
 * @module
 */

export type WatchdogMode = "exit" | "warn" | "off";

export interface WatchdogOptions {
  /** Site root; reports go to `<root>/.dune/hangs/`. */
  root: string;
  /** What to do on a stall. Default: `DUNE_WATCHDOG` env, else `exit`. */
  mode?: WatchdogMode;
  /** Heartbeat silence that counts as a stall. Default: `DUNE_WATCHDOG_TIMEOUT_MS` env, else 15000. */
  stallMs?: number;
  /** Heartbeat period. Default 1000; tests shorten it. */
  heartbeatMs?: number;
  /** Event-loop delay (over the expected tick) that logs a warning. Default 1000. */
  lagWarnMs?: number;
  /** Shown in the report and log line, e.g. `dev` / `serve`. */
  label?: string;
}

export interface Watchdog {
  stop(): void;
}

// The running watchdog's Worker, so request middleware can report to it.
let activeWorker: Worker | null = null;
let nextRequestId = 0;

/**
 * Record a request as in flight; call the returned function when it
 * finishes. A stall report then lists what was running, which is usually
 * the answer to "what hung?" — the native stack sample has no JS frames. A
 * no-op when no watchdog is running.
 */
export function trackRequest(method: string, path: string): () => void {
  const worker = activeWorker;
  if (!worker) return () => {};
  const id = ++nextRequestId;
  worker.postMessage({ type: "req+", id, desc: `${method} ${path}` });
  return () => worker.postMessage({ type: "req-", id });
}

const DEFAULT_STALL_MS = 15_000;
const DEFAULT_HEARTBEAT_MS = 1_000;
const DEFAULT_LAG_WARN_MS = 1_000;

/** Parse `DUNE_WATCHDOG`; anything unrecognised falls back to the default. */
export function parseWatchdogMode(value: string | undefined): WatchdogMode {
  const v = value?.trim().toLowerCase();
  return v === "off" || v === "warn" || v === "exit" ? v : "exit";
}

function parseStallMs(value: string | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1000 ? n : DEFAULT_STALL_MS;
}

// Runs in the Worker. Kept as a string so it works from any module origin
// (jsr:/https: included), where a relative worker URL would not.
const WORKER_SOURCE = `
let cfg = null;
let last = Date.now();
let fired = false;
const inflight = new Map(); // id -> { desc, since }
const pad = (n) => String(n).padStart(2, "0");

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
    "uptime:   " + Math.round((Date.now() - cfg.startedAt) / 1000) + "s",
    "stalled:  main thread silent for " + Math.round(silentMs / 1000) + "s (limit " +
      Math.round(cfg.stallMs / 1000) + "s)",
    "action:   " + (cfg.mode === "exit" ? "SIGKILL" : "none (DUNE_WATCHDOG=warn)"),
  ];
  const now2 = Date.now();
  const pending = [...inflight.values()].sort((a, b) => a.since - b.since);
  lines.push("in-flight requests: " + pending.length);
  for (const r of pending.slice(0, 20)) {
    lines.push("  " + r.desc + "  (" + Math.round((now2 - r.since) / 1000) + "s)");
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
  } catch (err) {
    lines.push("report:   could not be written (" + err + ")");
  }
  return lines;
}

self.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type === "init") {
    cfg = msg;
    last = Date.now();
    setInterval(async () => {
      const silent = Date.now() - last;
      if (fired || silent < cfg.stallMs) return;
      fired = true;
      console.error("[dune] watchdog: the main thread has not responded for " +
        Math.round(silent / 1000) + "s (event loop blocked)");
      const lines = await report(silent);
      for (const l of lines.filter((l) => /^(in-flight|  [A-Z]+ |sample|report)/.test(l))) {
        console.error("[dune] watchdog: " + l.trim());
      }
      if (cfg.mode === "exit") {
        console.error("[dune] watchdog: killing pid " + cfg.pid + " so it can be restarted");
        Deno.kill(cfg.pid, "SIGKILL");
      } else {
        fired = false; // 'warn': keep watching, and report again if it stays stuck
        last = Date.now();
      }
    }, 500);
  } else if (msg.type === "beat") {
    last = Date.now();
  } else if (msg.type === "req+") {
    inflight.set(msg.id, { desc: msg.desc, since: Date.now() });
  } else if (msg.type === "req-") {
    inflight.delete(msg.id);
  }
};
`;

/**
 * Start the watchdog for this process. Returns a handle whose `stop()` ends
 * it; a no-op handle when the mode is `off`.
 */
export function startWatchdog(opts: WatchdogOptions): Watchdog {
  const mode = opts.mode ?? parseWatchdogMode(Deno.env.get("DUNE_WATCHDOG"));
  if (mode === "off") return { stop() {} };

  const stallMs = opts.stallMs ?? parseStallMs(Deno.env.get("DUNE_WATCHDOG_TIMEOUT_MS"));
  const heartbeatMs = opts.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const lagWarnMs = opts.lagWarnMs ?? DEFAULT_LAG_WARN_MS;

  const url = URL.createObjectURL(
    new Blob([WORKER_SOURCE], { type: "application/javascript" }),
  );
  const worker = new Worker(url, { type: "module" });
  URL.revokeObjectURL(url);
  activeWorker = worker;
  worker.postMessage({
    type: "init",
    mode,
    stallMs,
    root: opts.root,
    pid: Deno.pid,
    label: opts.label ?? "dune",
    startedAt: Date.now(),
  });

  let expected = Date.now() + heartbeatMs;
  const timer = setInterval(() => {
    const now = Date.now();
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
  return { stop };
}
