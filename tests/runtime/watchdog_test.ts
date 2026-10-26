/**
 * Tests for the event-loop watchdog (src/runtime/watchdog.ts).
 *
 * The behaviour under test is a process killing itself while its main thread
 * is stuck in a loop, so every case runs a real child `deno` process and
 * inspects how it ended.
 */

import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { join } from "@std/path";
import { parseWatchdogMode } from "../../src/runtime/watchdog.ts";

const WATCHDOG_URL = new URL("../../src/runtime/watchdog.ts", import.meta.url).href;
const CHILD_DEADLINE_MS = 20_000;

interface ChildResult {
  code: number;
  signal: Deno.Signal | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Run `body` as a module that has already started a watchdog configured by `opts`. */
async function runChild(root: string, opts: string, body: string): Promise<ChildResult> {
  const script = join(root, "child.ts");
  await Deno.writeTextFile(
    script,
    `import { startWatchdog } from ${JSON.stringify(WATCHDOG_URL)};\n` +
      `const wd = startWatchdog({ root: ${JSON.stringify(root)}, ${opts} });\n${body}\n`,
  );
  const child = new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", script],
    stdout: "piped",
    stderr: "piped",
  }).spawn();
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

Deno.test("parseWatchdogMode: accepts the three modes, defaults anything else to exit", () => {
  assertEquals(parseWatchdogMode("off"), "off");
  assertEquals(parseWatchdogMode("WARN"), "warn");
  assertEquals(parseWatchdogMode(" exit "), "exit");
  assertEquals(parseWatchdogMode(undefined), "exit");
  assertEquals(parseWatchdogMode("nonsense"), "exit");
});

Deno.test(
  "watchdog (exit): a main thread stuck in a loop is SIGKILLed, with a report written first",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withRoot(async (root) => {
      const r = await runChild(
        root,
        `mode: "exit", stallMs: 1500, heartbeatMs: 100`,
        `import { trackRequest } from ${JSON.stringify(WATCHDOG_URL)};\n` +
          `trackRequest("GET", "/fine")();\n` +
          `trackRequest("GET", "/stuck");\n` +
          `setTimeout(() => { console.log("spinning"); while (true) {} }, 300);\n` +
          `Deno.serve({ port: 0, onListen: () => {} }, () => new Response("ok"));`,
      );
      assert(!r.timedOut, "child was still running at the deadline — the watchdog did not fire");
      assertEquals(r.signal, "SIGKILL");
      assertStringIncludes(r.stderr, "event loop blocked");
      const files = await reports(root);
      assert(files.some((f) => /^hang-.*\.txt$/.test(f) && !f.endsWith(".sample.txt")), `no report in ${files}`);
      const report = await Deno.readTextFile(
        join(root, ".dune", "hangs", files.find((f) => !f.endsWith(".sample.txt"))!),
      );
      assertStringIncludes(report, "main thread silent for");
      assertStringIncludes(report, "action:   SIGKILL");
      assertStringIncludes(report, "GET /stuck");
      assert(!report.includes("GET /fine"), "a finished request must not be listed");
    });
  },
);

Deno.test(
  "watchdog (warn): reports a stall but leaves the process alone",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withRoot(async (root) => {
      // Block for ~2.5s (past the 1.5s limit), then carry on and exit normally.
      const r = await runChild(
        root,
        `mode: "warn", stallMs: 1500, heartbeatMs: 100`,
        `setTimeout(async () => {\n` +
          `  const t = Date.now(); while (Date.now() - t < 2500) {}\n` +
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
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withRoot(async (root) => {
      const r = await runChild(
        root,
        `mode: "exit", stallMs: 5000, heartbeatMs: 100, lagWarnMs: 500`,
        `setTimeout(() => { const t = Date.now(); while (Date.now() - t < 900) {} }, 300);\n` +
          `setTimeout(() => wd.stop(), 1500);`,
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
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withRoot(async (root) => {
      // A Worker can't be unref'd, so stop() is the contract: once it has
      // been called (as `dune serve`'s shutdown does) nothing of the
      // watchdog may hold the process open.
      const r = await runChild(
        root,
        `mode: "exit", heartbeatMs: 100`,
        `setTimeout(() => wd.stop(), 300);`,
      );
      assert(!r.timedOut, "process lingered after its work was done");
      assertEquals(r.code, 0);
    });
  },
);

Deno.test(
  "watchdog (off): starts nothing and the process exits normally",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withRoot(async (root) => {
      const r = await runChild(root, `mode: "off"`, `console.log("done");`);
      assert(!r.timedOut);
      assertEquals(r.code, 0);
      assertStringIncludes(r.stdout, "done");
    });
  },
);
