/**
 * Tests for the event-loop watchdog (src/runtime/watchdog.ts).
 *
 * The behaviour under test is a process killing itself while its main thread
 * is stuck in a loop, so every case runs a real child `deno` process and
 * inspects how it ended.
 */

import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { join } from "@std/path";
import { maskPath, parseWatchdogMode } from "../../src/runtime/watchdog.ts";

const WATCHDOG_URL = new URL("../../src/runtime/watchdog.ts", import.meta.url).href;
const CHILD_DEADLINE_MS = 25_000;
const noSanitize = { sanitizeOps: false, sanitizeResources: false };
const unixOnly = { ...noSanitize, ignore: Deno.build.os === "windows" };

interface ChildResult {
  code: number;
  signal: Deno.Signal | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

interface ChildOptions {
  env?: Record<string, string>;
  /** Extra args to `deno run` (permissions, inspector flags). Default: `-A`. */
  denoArgs?: string[];
}

/** Run `body` as a module that has already started a watchdog configured by `opts`. */
async function runChild(root: string, opts: string, body: string, extra: ChildOptions = {}): Promise<ChildResult> {
  const script = join(root, "child.ts");
  await Deno.writeTextFile(
    script,
    `import { startWatchdog, watchdogProgress, watchdogGrace } from ${JSON.stringify(WATCHDOG_URL)};\n` +
      `const wd = startWatchdog({ root: ${JSON.stringify(root)}, ${opts} });\n${body}\n`,
  );
  const child = new Deno.Command(Deno.execPath(), {
    args: ["run", ...(extra.denoArgs ?? ["-A"]), script],
    env: extra.env,
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  return await finish(child);
}

async function finish(child: Deno.ChildProcess): Promise<ChildResult> {
  let timedOut = false;
  const killer = setTimeout(() => {
    timedOut = true;
    try {
      child.kill("SIGKILL");
    } catch { /* already gone */ }
  }, CHILD_DEADLINE_MS);
  const out = await child.output();
  clearTimeout(killer);
  const dec = new TextDecoder();
  return {
    code: out.code,
    signal: out.signal,
    stdout: dec.decode(out.stdout),
    stderr: dec.decode(out.stderr),
    timedOut,
  };
}

async function withRoot(fn: (root: string) => Promise<void>): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "dune_test_watchdog_" });
  try {
    await fn(root);
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
}

async function reports(root: string): Promise<string[]> {
  try {
    const names: string[] = [];
    for await (const e of Deno.readDir(join(root, ".dune", "hangs"))) names.push(e.name);
    return names.sort();
  } catch {
    return [];
  }
}

const mainReports = (names: string[]) => names.filter((f) => /^hang-.*\.txt$/.test(f) && !f.endsWith(".sample.txt"));

/** Busy-wait `ms` of wall time. */
const SPIN = (ms: number) => `{ const t = Date.now(); while (Date.now() - t < ${ms}) {} }`;

// ── units ────────────────────────────────────────────────────────────────────

Deno.test("parseWatchdogMode: accepts the three modes, defaults anything else to exit", () => {
  assertEquals(parseWatchdogMode("off"), "off");
  assertEquals(parseWatchdogMode("WARN"), "warn");
  assertEquals(parseWatchdogMode(" exit "), "exit");
  assertEquals(parseWatchdogMode(undefined), "exit");
  assertEquals(parseWatchdogMode("nonsense"), "exit");
});

Deno.test("maskPath: short segments are kept, token-sized ones are cut", () => {
  assertEquals(maskPath("/blog/my-first-post/"), "/blog/my-first-post/");
  assertEquals(maskPath("/auth/verify/0123456789abcdef0123456789abcdef"), "/auth/verify/012345…");
  assertEquals(maskPath("/a/b"), "/a/b");
});

// ── the kill ─────────────────────────────────────────────────────────────────

Deno.test(
  "watchdog (exit): a main thread stuck in a loop is SIGKILLed, with a report written first",
  noSanitize,
  async () => {
    await withRoot(async (root) => {
      const r = await runChild(
        root,
        `mode: "exit", stallMs: 1500, startupStallMs: 1500, heartbeatMs: 100`,
        `import { trackRequest } from ${JSON.stringify(WATCHDOG_URL)};\n` +
          `trackRequest("GET", "/fine")();\n` +
          `trackRequest("GET", "/stuck/0123456789abcdef0123456789abcdef");\n` +
          `setTimeout(() => { console.log("spinning"); while (true) {} }, 300);\n` +
          `Deno.serve({ port: 0, onListen: () => {} }, () => new Response("ok"));`,
      );
      assert(!r.timedOut, "child was still running at the deadline — the watchdog did not fire");
      assertEquals(r.signal, "SIGKILL");
      assertStringIncludes(r.stderr, "event loop blocked");
      const files = mainReports(await reports(root));
      assert(files.length > 0, `no report in ${await reports(root)}`);
      const report = await Deno.readTextFile(join(root, ".dune", "hangs", files[0]));
      assertStringIncludes(report, "main thread silent for");
      assertStringIncludes(report, "action:   SIGKILL");
      assertStringIncludes(report, "GET /stuck/");
      assert(!report.includes("0123456789abcdef0123456789abcdef"), "a token-sized path segment must be masked");
      assert(!report.includes("GET /fine"), "a finished request must not be listed");
    });
  },
);

Deno.test(
  "watchdog (warn): reports a stall but leaves the process alone",
  noSanitize,
  async () => {
    await withRoot(async (root) => {
      // Block for ~2.5s (past the 1.5s limit), then carry on and exit normally.
      const r = await runChild(
        root,
        `mode: "warn", stallMs: 1500, startupStallMs: 1500, heartbeatMs: 100`,
        `setTimeout(async () => {\n` +
          `  ${SPIN(2500)}\n` +
          `  // Let the report (and macOS 'sample') finish before stopping.\n` +
          `  for (let i = 0; i < 100; i++) {\n` +
          `    try { for await (const e of Deno.readDir(${JSON.stringify(root)} + "/.dune/hangs")) if (e.name.endsWith(".txt") && !e.name.endsWith(".sample.txt")) { wd.stop(); Deno.exit(0); } } catch {}\n` +
          `    await new Promise((r) => setTimeout(r, 100));\n` +
          `  }\n` +
          `  wd.stop();\n` +
          `}, 300);`,
      );
      assert(!r.timedOut);
      assertEquals(r.code, 0);
      assertEquals(r.signal, null);
      assertStringIncludes(r.stderr, "event loop blocked");
      assert((await reports(root)).length > 0, "expected a report file");
    });
  },
);

Deno.test(
  "watchdog: a briefly blocked loop under the limit is not reported, but the lag is logged",
  noSanitize,
  async () => {
    await withRoot(async (root) => {
      const r = await runChild(
        root,
        `mode: "exit", stallMs: 5000, heartbeatMs: 100, lagWarnMs: 500`,
        `setTimeout(() => { ${SPIN(900)} }, 300);\n` + `setTimeout(() => wd.stop(), 1500);`,
      );
      assert(!r.timedOut);
      assertEquals(r.code, 0);
      assertStringIncludes(r.stderr, "event loop was blocked for");
      assertEquals((await reports(root)).length, 0);
    });
  },
);

Deno.test(
  "watchdog: after stop(), a finished process exits on its own",
  noSanitize,
  async () => {
    await withRoot(async (root) => {
      // A Worker can't be unref'd, so stop() is the contract: once it has
      // been called (as `dune serve`'s shutdown does) nothing of the
      // watchdog may hold the process open.
      const r = await runChild(root, `mode: "exit", heartbeatMs: 100`, `setTimeout(() => wd.stop(), 300);`);
      assert(!r.timedOut, "process lingered after its work was done");
      assertEquals(r.code, 0);
    });
  },
);

Deno.test(
  "watchdog: a worker that fails to load disables the watchdog instead of crashing the process",
  noSanitize,
  async () => {
    await withRoot(async (root) => {
      const script = join(root, "child.ts");
      await Deno.writeTextFile(
        script,
        `const Real = globalThis.Worker;\n` +
          `globalThis.Worker = class extends Real {\n` +
          `  constructor(_url, o) { super("data:application/javascript,throw new Error('boom')", o); }\n` +
          `};\n` +
          `const { startWatchdog } = await import(${JSON.stringify(WATCHDOG_URL)});\n` +
          `startWatchdog({ root: ${JSON.stringify(root)}, mode: "exit" });\n` +
          `await new Promise((r) => setTimeout(r, 1000));\n` +
          `console.log("survived");\n`,
      );
      const r = await finish(
        new Deno.Command(Deno.execPath(), { args: ["run", "-A", script], stdout: "piped", stderr: "piped" }).spawn(),
      );
      assert(!r.timedOut, "process lingered");
      assertEquals(r.code, 0, r.stderr);
      assertStringIncludes(r.stdout, "survived");
      assertStringIncludes(r.stderr, "watchdog disabled");
    });
  },
);

Deno.test(
  "watchdog (off): starts nothing and the process exits normally",
  noSanitize,
  async () => {
    await withRoot(async (root) => {
      const r = await runChild(root, `mode: "off"`, `console.log("done");`);
      assert(!r.timedOut);
      assertEquals(r.code, 0);
      assertStringIncludes(r.stdout, "done");
    });
  },
);

// ── not killing what shouldn't be killed ─────────────────────────────────────

Deno.test(
  "watchdog: a process suspended and resumed (laptop sleep, Ctrl-Z) is not mistaken for a hang",
  unixOnly,
  async () => {
    await withRoot(async (root) => {
      const script = join(root, "child.ts");
      await Deno.writeTextFile(
        script,
        `import { startWatchdog } from ${JSON.stringify(WATCHDOG_URL)};\n` +
          `const wd = startWatchdog({ root: ${JSON.stringify(root)}, mode: "exit", stallMs: 1500, startupStallMs: 1500, heartbeatMs: 100 });\n` +
          `wd.ready();\nconsole.log("ready");\nsetTimeout(() => wd.stop(), 7000);\n`,
      );
      const child = new Deno.Command(Deno.execPath(), { args: ["run", "-A", script], stdout: "piped", stderr: "piped" }).spawn();
      // Wait until the watchdog is running, then freeze the whole process well past the limit.
      const reader = child.stdout.getReader();
      const first = await reader.read();
      assertStringIncludes(new TextDecoder().decode(first.value), "ready");
      reader.releaseLock();
      await new Promise((r) => setTimeout(r, 400));
      Deno.kill(child.pid, "SIGSTOP");
      await new Promise((r) => setTimeout(r, 3500));
      Deno.kill(child.pid, "SIGCONT");
      const r = await finish(child);
      assert(!r.timedOut);
      assertEquals(r.signal, null, `was killed after resume:\n${r.stderr}`);
      assertEquals(r.code, 0);
      assertEquals((await reports(root)).length, 0, "no report for a pause");
    });
  },
);

Deno.test(
  "watchdog: until ready() the long startup limit applies; after it, the normal one",
  noSanitize,
  async () => {
    await withRoot(async (root) => {
      // 2.5s of blocking during startup is over the 1.5s normal limit but under the 6s startup limit.
      const startup = await runChild(
        root,
        `mode: "exit", stallMs: 1500, startupStallMs: 6000, heartbeatMs: 100`,
        `setTimeout(() => { ${SPIN(2500)} wd.stop(); }, 300);`,
      );
      assert(!startup.timedOut);
      assertEquals(startup.signal, null, `killed during startup:\n${startup.stderr}`);
      assertEquals(startup.code, 0);

      // The same block after ready() is a stall.
      const serving = await runChild(
        root,
        `mode: "exit", stallMs: 1500, startupStallMs: 6000, heartbeatMs: 100`,
        `wd.ready();\nsetTimeout(() => { while (true) {} }, 300);`,
      );
      assert(!serving.timedOut);
      assertEquals(serving.signal, "SIGKILL");
    });
  },
);

Deno.test(
  "watchdogProgress: a synchronous loop that keeps reporting progress survives, one that doesn't is killed",
  noSanitize,
  async () => {
    await withRoot(async (root) => {
      const alive = await runChild(
        root,
        `mode: "exit", stallMs: 1500, startupStallMs: 1500, heartbeatMs: 100`,
        `wd.ready();\nsetTimeout(() => { const t = Date.now(); while (Date.now() - t < 3500) { watchdogProgress(); } wd.stop(); }, 300);`,
      );
      assert(!alive.timedOut);
      assertEquals(alive.signal, null, `a loop reporting progress was killed:\n${alive.stderr}`);
      assertEquals(alive.code, 0);

      const stuck = await runChild(
        root,
        `mode: "exit", stallMs: 1500, startupStallMs: 1500, heartbeatMs: 100`,
        `wd.ready();\nsetTimeout(() => { while (true) {} }, 300);`,
      );
      assertEquals(stuck.signal, "SIGKILL");
    });
  },
);

Deno.test(
  "watchdogGrace: protects a declared busy window, is logged, and expires on its own",
  noSanitize,
  async () => {
    await withRoot(async (root) => {
      const within = await runChild(
        root,
        `mode: "exit", stallMs: 1500, startupStallMs: 1500, heartbeatMs: 100`,
        `wd.ready();\nsetTimeout(() => { const release = watchdogGrace(10000, "test import"); ${SPIN(3500)} release(); wd.stop(); }, 300);`,
      );
      assert(!within.timedOut);
      assertEquals(within.signal, null, `killed inside its grace window:\n${within.stderr}`);
      assertStringIncludes(within.stderr, 'grace for "test import"');

      // A 1s window followed by a loop that never ends: the window must lapse and the kill follow.
      const expired = await runChild(
        root,
        `mode: "exit", stallMs: 1500, startupStallMs: 1500, heartbeatMs: 100`,
        `wd.ready();\nsetTimeout(() => { watchdogGrace(1000, "short"); while (true) {} }, 300);`,
      );
      assert(!expired.timedOut, "grace never expired");
      assertEquals(expired.signal, "SIGKILL");
    });
  },
);

Deno.test(
  "watchdog: nested grace windows are refcounted — releasing one leaves the other in force",
  noSanitize,
  async () => {
    await withRoot(async (root) => {
      const r = await runChild(
        root,
        `mode: "exit", stallMs: 1500, startupStallMs: 1500, heartbeatMs: 100`,
        `wd.ready();\nsetTimeout(() => {\n` +
          `  const outer = watchdogGrace(10000, "outer");\n` +
          `  const inner = watchdogGrace(10000, "inner");\n` +
          `  inner();\n` +
          `  ${SPIN(3000)}\n` +
          `  outer(); wd.stop();\n` +
          `}, 300);`,
      );
      assert(!r.timedOut);
      assertEquals(r.signal, null, `outer window should still have protected the loop:\n${r.stderr}`);
    });
  },
);

Deno.test(
  "watchdog: under an inspector it reports instead of killing, since a breakpoint pauses only the main thread",
  unixOnly,
  async () => {
    await withRoot(async (root) => {
      const env = Deno.env.toObject();
      delete env.DUNE_WATCHDOG;
      const r = await runChild(
        root,
        `stallMs: 1500, startupStallMs: 1500, heartbeatMs: 100`, // no mode option and no DUNE_WATCHDOG: the default applies
        `wd.ready();\nsetTimeout(() => { ${SPIN(2500)} setTimeout(() => wd.stop(), 1500); }, 300);`,
        { denoArgs: ["-A", "--inspect=127.0.0.1:19349"], env },
      );
      assert(!r.timedOut);
      assertEquals(r.signal, null, `was killed under an inspector:\n${r.stderr}`);
      assertEquals(r.code, 0);
      assertStringIncludes(r.stderr, "inspector detected");
      assertStringIncludes(r.stderr, "event loop blocked");
    });
  },
);

// ── the kill must always happen, and say so when it can't ────────────────────

Deno.test(
  "watchdog: the kill goes ahead even when writing the report hangs (a stuck 'sample')",
  { ...noSanitize, ignore: Deno.build.os !== "darwin" },
  async () => {
    await withRoot(async (root) => {
      const bin = join(root, "fakebin");
      await Deno.mkdir(bin);
      await Deno.writeTextFile(join(bin, "sample"), "#!/bin/sh\nsleep 60\n");
      await Deno.chmod(join(bin, "sample"), 0o755);
      const r = await runChild(
        root,
        `mode: "exit", stallMs: 1500, startupStallMs: 1500, heartbeatMs: 100, reportTimeoutMs: 1000`,
        `wd.ready();\nsetTimeout(() => { while (true) {} }, 300);`,
        { env: { ...Deno.env.toObject(), PATH: `${bin}:${Deno.env.get("PATH")}` } },
      );
      assert(!r.timedOut, "a hung report prevented the kill");
      assertEquals(r.signal, "SIGKILL");
      assertStringIncludes(r.stderr, "did not finish");
    });
  },
);

// ── bookkeeping ──────────────────────────────────────────────────────────────

Deno.test(
  "watchdog: old reports are pruned so .dune/hangs/ can't grow without bound",
  noSanitize,
  async () => {
    await withRoot(async (root) => {
      const dir = join(root, ".dune", "hangs");
      await Deno.mkdir(dir, { recursive: true });
      for (let i = 0; i < 24; i++) {
        const stamp = `20200101-0000${String(i).padStart(2, "0")}-1`;
        await Deno.writeTextFile(join(dir, `hang-${stamp}.txt`), "old\n");
        await Deno.writeTextFile(join(dir, `hang-${stamp}.sample.txt`), "old sample\n");
      }
      const r = await runChild(
        root,
        `mode: "warn", stallMs: 1500, startupStallMs: 1500, heartbeatMs: 100`,
        `wd.ready();\nsetTimeout(async () => {\n` +
          `  ${SPIN(2500)}\n` +
          `  for (let i = 0; i < 100; i++) {\n` +
          `    let n = 0; for await (const e of Deno.readDir(${JSON.stringify(dir)})) if (/^hang-2026|^hang-20[3-9]/.test(e.name) && e.name.endsWith(".txt") && !e.name.endsWith(".sample.txt")) n++;\n` +
          `    if (n > 0) { await new Promise((r) => setTimeout(r, 500)); break; }\n` +
          `    await new Promise((r) => setTimeout(r, 100));\n` +
          `  }\n` +
          `  wd.stop();\n` +
          `}, 300);`,
      );
      assert(!r.timedOut);
      const names = await reports(root);
      assertEquals(mainReports(names).length, 20, `expected 20 reports kept, got ${mainReports(names).length}`);
      assertEquals(names.filter((n) => n.endsWith(".sample.txt")).length <= 20, true, "pruned reports take their samples with them");
    });
  },
);

// ── what the supervisor and the dune dev wrapper see ─────────────────────────

Deno.test(
  "watchdog: a wrapper around a killed process exits non-zero, and a child that reads stdin (like esbuild) does not outlive it",
  unixOnly,
  async () => {
    await withRoot(async (root) => {
      const forward = new URL("../../src/cli/forward-signals.ts", import.meta.url).href;
      const pidFile = join(root, "grandchild.pid");
      await Deno.writeTextFile(
        join(root, "server.ts"),
        `import { startWatchdog } from ${JSON.stringify(WATCHDOG_URL)};\n` +
          `const wd = startWatchdog({ root: ${JSON.stringify(root)}, mode: "exit", stallMs: 1500, startupStallMs: 1500, heartbeatMs: 100 });\n` +
          `wd.ready();\n` +
          // Stands in for the esbuild service: exits when its stdin closes (the parent died).
          `const g = new Deno.Command(Deno.execPath(), { args: ["eval", "await Deno.stdin.read(new Uint8Array(1))"], stdin: "piped", stdout: "null", stderr: "null" }).spawn();\n` +
          `await Deno.writeTextFile(${JSON.stringify(pidFile)}, String(g.pid));\n` +
          `setTimeout(() => { while (true) {} }, 400);\n`,
      );
      // Same shape as the dune re-exec wrapper (src/cli/reexec.ts).
      await Deno.writeTextFile(
        join(root, "wrapper.ts"),
        `import { waitForwardingSignals } from ${JSON.stringify(forward)};\n` +
          `const child = new Deno.Command(Deno.execPath(), { args: ["run", "-A", ${JSON.stringify(join(root, "server.ts"))}], stdout: "null", stderr: "null" }).spawn();\n` +
          `const status = await waitForwardingSignals(child);\nDeno.exit(status.code);\n`,
      );
      const wrapper = new Deno.Command(Deno.execPath(), { args: ["run", "-A", join(root, "wrapper.ts")], stdout: "piped", stderr: "piped" }).spawn();
      const r = await finish(wrapper);
      assert(!r.timedOut, "the wrapper never saw its child die");
      assertEquals(r.code, 137, "the wrapper must exit non-zero so a supervisor sees a failure");

      const gpid = Number(await Deno.readTextFile(pidFile));
      let alive = true;
      for (let i = 0; i < 30 && alive; i++) {
        await new Promise((res) => setTimeout(res, 100));
        const ps = await new Deno.Command("ps", { args: ["-p", String(gpid)], stdout: "null", stderr: "null" }).output();
        alive = ps.success;
      }
      assertEquals(alive, false, "a child reading the parent's stdin should end when the parent is SIGKILLed");
    });
  },
);

Deno.test("watchdog: the worker blob URL is never revoked (revoking races the async module load)", async () => {
  const src = await Deno.readTextFile(new URL("../../src/runtime/watchdog.ts", import.meta.url));
  assert(!/revokeObjectURL\s*\(/.test(src.replace(/\/\/.*$/gm, "")), "revokeObjectURL would race the worker load");
});
