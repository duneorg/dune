/**
 * Tests for `dune stop` (src/cli/stop.ts).
 *
 * Three layers: real processes for the signalling (stopInstances), a pure
 * table for target selection (selectInstances), and the command flow against
 * injected fakes, so no flow test can stop a real instance.
 */

import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { join } from "@std/path";
import { type DuneInstance, findDuneInstances } from "../../src/cli/instances.ts";
import { selectInstances, type StopOptions, stopCommand, stopInstances } from "../../src/cli/stop.ts";
import { fakeInstance, opts, realStartTimes, startTaskTree, stop } from "./ps_helpers.ts";

// ── stopInstances: real processes ────────────────────────────────────────────

Deno.test("stopInstances: stops the whole tree and reports nothing left", opts, async () => {
  const port = 18_914;
  const { site, child } = await startTaskTree(port);
  try {
    const found = (await findDuneInstances()).find((i) => i.pids.includes(child.pid));
    assertExists(found);
    const result = await stopInstances([found], { timeoutMs: 8000 });
    assertEquals(result.survivors, []);
    assertEquals(result.skipped, []);
    assertEquals(result.killed, [], "a process that exits on SIGTERM must not be SIGKILLed");
    assertEquals(result.stopped.sort(), [...found.pids].sort());
    let answered = true;
    try {
      await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(800) });
    } catch {
      answered = false;
    }
    assertEquals(answered, false);
  } finally {
    await stop(child);
    await Deno.remove(site, { recursive: true }).catch(() => {});
  }
});

/** A process that swallows SIGTERM, the way a server stuck in its own shutdown does. */
async function withStubbornProcess(fn: (pid: number, child: Deno.ChildProcess) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "stop_test_stubborn_" });
  let child: Deno.ChildProcess | undefined;
  try {
    await Deno.writeTextFile(
      join(dir, "stubborn.ts"),
      `Deno.addSignalListener("SIGTERM", () => {});\nconsole.log("ready");\nsetInterval(() => {}, 1000);\n`,
    );
    child = new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", "stubborn.ts"],
      cwd: dir,
      stdout: "piped",
      stderr: "null",
    }).spawn();
    // Wait until the handler is installed, or SIGTERM would just kill it.
    const reader = child.stdout.getReader();
    const first = await reader.read();
    assertEquals(new TextDecoder().decode(first.value).includes("ready"), true);
    reader.releaseLock();
    await fn(child.pid, child);
  } finally {
    if (child) {
      try {
        child.kill("SIGKILL");
      } catch { /* already gone */ }
      await child.status.catch(() => {});
    }
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
}

Deno.test("stopInstances: without force, a process that ignores SIGTERM is left alone and reported", opts, async () => {
  await withStubbornProcess(async (pid, child) => {
    const result = await stopInstances([fakeInstance({ pid, pids: [pid], startTimes: await realStartTimes([pid]) })], { timeoutMs: 600 });
    assertEquals(result.survivors, [pid]);
    assertEquals(result.killed, []);
    assertEquals(result.stopped, []);
    // Still running: nothing sent SIGKILL.
    assertEquals(await Promise.race([child.status.then(() => "exited"), new Promise((r) => setTimeout(() => r("alive"), 300))]), "alive");
  });
});

Deno.test("stopInstances: with force, that process is SIGKILLed after the grace period and reported as killed", opts, async () => {
  await withStubbornProcess(async (pid, child) => {
    const result = await stopInstances([fakeInstance({ pid, pids: [pid], startTimes: await realStartTimes([pid]) })], { force: true, timeoutMs: 600, killTimeoutMs: 5000 });
    assertEquals(result.killed, [pid]);
    assertEquals(result.stopped, [pid]);
    assertEquals(result.survivors, []);
    assertEquals((await child.status).signal, "SIGKILL");
  });
});

Deno.test("stopInstances: never signals this process, even if an instance lists it", async () => {
  const result = await stopInstances([fakeInstance({ pids: [Deno.pid] })], { timeoutMs: 300, force: true });
  assertEquals(result.skipped, [Deno.pid]);
  assertEquals(result.stopped, []);
  assertEquals(result.killed, []);
  assertEquals(result.survivors, []);
  // (If it had signalled itself, this assertion would never run.)
});

Deno.test("stopInstances: a pid whose start time no longer matches (exited and reused) is not signalled", opts, async () => {
  await withStubbornProcess(async (pid, child) => {
    // The instance was "found" when pid belonged to some other process: here, a different start time.
    const result = await stopInstances(
      [fakeInstance({ pid, pids: [pid], startTimes: { [pid]: "Mon Jan 1 00:00:00 2001" } })],
      { force: true, timeoutMs: 600, killTimeoutMs: 600 },
    );
    assertEquals(result.changed, [pid]);
    assertEquals(result.stopped, []);
    assertEquals(result.killed, []);
    assertEquals(await Promise.race([child.status.then(() => "exited"), new Promise((r) => setTimeout(() => r("alive"), 300))]), "alive", "must not have been signalled, not even by SIGKILL");
  });
});

Deno.test("stopInstances: a pid recorded without a start time is never signalled", opts, async () => {
  await withStubbornProcess(async (pid, child) => {
    const result = await stopInstances([fakeInstance({ pid, pids: [pid], startTimes: {} })], { force: true, timeoutMs: 600, killTimeoutMs: 600 });
    assertEquals(result.changed, [pid]);
    assertEquals(await Promise.race([child.status.then(() => "exited"), new Promise((r) => setTimeout(() => r("alive"), 300))]), "alive");
  });
});

Deno.test("stopInstances: a process the operating system refuses to signal is reported as denied, not as ignoring SIGTERM", {
  ...opts,
  ignore: Deno.uid() === 0, // as root pid 1 would really be signalled
}, async () => {
  // pid 1 belongs to root; SIGTERM from an ordinary user is refused (EPERM).
  const result = await stopInstances([fakeInstance({ pid: 1, pids: [1], startTimes: await realStartTimes([1]) })], { timeoutMs: 300 });
  assertEquals(result.denied, [1]);
  assertEquals(result.stopped, []);
  assertEquals(result.survivors, []);
});

const STOP_URL = new URL("../../src/cli/stop.ts", import.meta.url).href;
const INSTANCES_URL = new URL("../../src/cli/instances.ts", import.meta.url).href;
const PS_URL = new URL("../../src/cli/ps.ts", import.meta.url).href;
const DUNE_CONFIG = new URL("../../deno.json", import.meta.url).pathname;

/** Run a small script under a restricted set of permissions and return what it printed. */
async function runRestricted(dir: string, code: string, permFlags: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const script = join(dir, "restricted.ts");
  await Deno.writeTextFile(script, code);
  const out = await new Deno.Command(Deno.execPath(), {
    args: ["run", `--config=${DUNE_CONFIG}`, ...permFlags, script],
    stdout: "piped",
    stderr: "piped",
  }).output();
  const dec = new TextDecoder();
  return { ok: out.success, stdout: dec.decode(out.stdout), stderr: dec.decode(out.stderr) };
}

Deno.test("dune ps works without --allow-sys (our own uid comes from our own process-table row)", opts, async () => {
  const dir = await Deno.makeTempDir({ prefix: "stop_test_perm_" });
  try {
    const r = await runRestricted(
      dir,
      `import { psCommand } from ${JSON.stringify(PS_URL)};\nawait psCommand({ log: () => {} });\nconsole.log("fine");\n`,
      ["--allow-run", "--allow-read", "--allow-env"],
    );
    assertEquals(r.ok, true, r.stderr);
    assertEquals(r.stdout.includes("fine"), true);
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
});

Deno.test("without --allow-run, finding instances fails loudly with the fix, instead of reporting none", opts, async () => {
  const dir = await Deno.makeTempDir({ prefix: "stop_test_perm_" });
  try {
    const r = await runRestricted(
      dir,
      `import { findDuneInstances, MissingPermissionError } from ${JSON.stringify(INSTANCES_URL)};\n` +
        `try { await findDuneInstances(); console.log("NO ERROR"); } catch (e) { console.log(e instanceof MissingPermissionError ? e.message : "WRONG " + e); }\n`,
      ["--allow-read", "--allow-env"],
    );
    assertEquals(r.stdout.includes("--allow-run"), true, r.stdout + r.stderr);
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
});

Deno.test("a kill refused by Deno's own permissions is reported as needing --allow-run, not as 'already gone'", opts, async () => {
  await withStubbornProcess(async (pid, child) => {
    const dir = await Deno.makeTempDir({ prefix: "stop_test_perm_" });
    try {
      const times = await realStartTimes([pid]);
      const r = await runRestricted(
        dir,
        `import { stopInstances } from ${JSON.stringify(STOP_URL)};\n` +
          `const inst = { pid: ${pid}, pids: [${pid}], mode: "serve", root: null, title: null, ports: [], portStatus: "not-listening", elapsed: "1:00", ageSeconds: 60, confirmed: true, startTimes: ${JSON.stringify(times)}, command: "x" };\n` +
          `console.log(JSON.stringify(await stopInstances([inst], { timeoutMs: 300 })));\n`,
        // `ps` may run, signalling may not.
        ["--allow-run=ps", "--allow-read", "--allow-env", "--allow-sys"],
      );
      assertEquals(r.ok, true, r.stderr);
      const result = JSON.parse(r.stdout.trim().split("\n").pop()!);
      assertEquals(result.needsPermission, [pid], r.stdout);
      assertEquals(result.changed, [], "must not be reported as 'already exited'");
      // And it really was not signalled.
      assertEquals(await Promise.race([child.status.then(() => "exited"), new Promise((x) => setTimeout(() => x("alive"), 300))]), "alive");
    } finally {
      await Deno.remove(dir, { recursive: true }).catch(() => {});
    }
  });
});

// ── selectInstances ──────────────────────────────────────────────────────────

const LIVE = () => fakeInstance({ pid: 10, pids: [10, 11], ports: [3000], portStatus: "listening", title: "Live Site" });
const IDLE_A = () => fakeInstance({ pid: 20, pids: [20], title: "Idle A" });
const IDLE_B = () => fakeInstance({ pid: 30, pids: [30, 31, 32], title: "Idle B" });
const ALL = () => [LIVE(), IDLE_A(), IDLE_B()];

function pidsOf(sel: ReturnType<typeof selectInstances>): number[] {
  if (!sel.ok) throw new Error(`expected a selection, got: ${sel.message}`);
  return sel.instances.map((i) => i.pid);
}

Deno.test("selectInstances: no target is a usage error (exit 2) and selects nothing", () => {
  const sel = selectInstances(ALL(), {});
  assertEquals(sel.ok, false);
  if (!sel.ok) {
    assertEquals(sel.exitCode, 2);
    assertEquals(sel.message.includes("Usage: dune stop"), true);
  }
});

Deno.test("selectInstances: more than one target is a usage error, never a union", () => {
  for (const o of [{ pid: "10", all: true }, { port: "3000", idle: true }, { idle: true, all: true }, { pid: "10", port: "3000" }] as StopOptions[]) {
    const sel = selectInstances(ALL(), o);
    assertEquals(sel.ok, false, JSON.stringify(o));
    if (!sel.ok) assertEquals(sel.exitCode, 2);
  }
});

Deno.test("selectInstances: a pid matches the instance by its top process OR any child process", () => {
  assertEquals(pidsOf(selectInstances(ALL(), { pid: "10" })), [10]);
  assertEquals(pidsOf(selectInstances(ALL(), { pid: "11" })), [10], "a child pid selects its whole instance");
  assertEquals(pidsOf(selectInstances(ALL(), { pid: "32" })), [30]);
});

Deno.test("selectInstances: a pid or port nobody has is a failure (exit 1), naming it", () => {
  const pid = selectInstances(ALL(), { pid: "424242" });
  assertEquals(pid.ok, false);
  if (!pid.ok) {
    assertEquals(pid.exitCode, 1);
    assertEquals(pid.message.includes("424242"), true);
  }
  const port = selectInstances(ALL(), { port: "9999" });
  assertEquals(port.ok, false);
  if (!port.ok) assertEquals(port.exitCode, 1);
});

Deno.test("selectInstances: --port picks the instance listening on it", () => {
  assertEquals(pidsOf(selectInstances(ALL(), { port: "3000" })), [10]);
});

Deno.test("selectInstances: invalid numbers are usage errors (exit 2)", () => {
  for (const o of [{ pid: "abc" }, { pid: "-5" }, { pid: "0" }, { pid: "1.5" }, { port: "70000" }, { port: "x" }] as StopOptions[]) {
    const sel = selectInstances(ALL(), o);
    assertEquals(sel.ok, false, JSON.stringify(o));
    if (!sel.ok) assertEquals(sel.exitCode, 2, JSON.stringify(o));
  }
});

Deno.test("selectInstances: --idle takes only not-listening instances, never a listening one or its children", () => {
  const sel = selectInstances(ALL(), { idle: true });
  assertEquals(pidsOf(sel), [20, 30]);
  if (sel.ok) assertEquals(sel.instances.flatMap((i) => i.pids).some((p) => p === 10 || p === 11), false);
});

Deno.test("selectInstances: --idle with everything listening is a clean no-op (exit 0)", () => {
  const sel = selectInstances([LIVE()], { idle: true });
  assertEquals(sel.ok, false);
  if (!sel.ok) {
    assertEquals(sel.exitCode, 0);
    assertEquals(sel.message.includes("No idle instances: all 1 confirmed running instance is listening"), true);
  }
});

Deno.test("selectInstances: --idle without lsof assumes nothing is idle (exit 1)", () => {
  const sel = selectInstances([fakeInstance({ pid: 40, pids: [40], portStatus: "unknown" })], { idle: true });
  assertEquals(sel.ok, false);
  if (!sel.ok) {
    assertEquals(sel.exitCode, 1);
    assertEquals(sel.message.includes("Can't tell which instances are idle"), true);
  }
});

Deno.test("selectInstances: --all and --idle leave out unconfirmed instances, and say how to stop them", () => {
  const stray = fakeInstance({ pid: 70, pids: [70], confirmed: false, root: null, title: null });
  const all = selectInstances([...ALL(), stray], { all: true });
  assertEquals(pidsOf(all), [10, 20, 30]);
  if (all.ok) assertEquals(all.notes.some((n) => n.includes("by pid")), true);
  const idle = selectInstances([...ALL(), stray], { idle: true });
  assertEquals(pidsOf(idle), [20, 30], "an unconfirmed not-listening process is not 'idle' to kill");
});

Deno.test("selectInstances: only unconfirmed instances running — --all is a clean no-op that explains why", () => {
  const stray = fakeInstance({ pid: 70, pids: [70], confirmed: false });
  const sel = selectInstances([stray], { all: true });
  assertEquals(sel.ok, false);
  if (!sel.ok) {
    assertEquals(sel.exitCode, 0);
    assertEquals(sel.message.includes("confirmed dune site"), true);
  }
});

Deno.test("selectInstances: an unconfirmed instance can still be stopped by naming it, with a warning", () => {
  const stray = fakeInstance({ pid: 70, pids: [70, 71], confirmed: false });
  const sel = selectInstances([stray], { pid: "71" });
  assertEquals(pidsOf(sel), [70]);
  if (sel.ok) assertEquals(sel.notes[0].includes("Not confirmed"), true);
});

Deno.test("selectInstances: --idle leaves out a not-listening instance that is still young (it may be starting)", () => {
  const young = fakeInstance({ pid: 80, pids: [80], ageSeconds: 45 });
  const old = fakeInstance({ pid: 81, pids: [81], ageSeconds: 600 });
  const sel = selectInstances([young, old], { idle: true });
  assertEquals(pidsOf(sel), [81]);
  if (sel.ok) assertEquals(sel.notes.some((n) => n.includes("still be starting")), true);
  // Nothing old enough: a clean no-op that says why.
  const none = selectInstances([young], { idle: true });
  assertEquals(none.ok, false);
  if (!none.ok) {
    assertEquals(none.exitCode, 0);
    assertEquals(none.message.includes("may still be starting"), true);
  }
});

Deno.test("selectInstances: --all takes everything", () => {
  assertEquals(pidsOf(selectInstances(ALL(), { all: true })), [10, 20, 30]);
});

// ── stopCommand flow (fakes only) ────────────────────────────────────────────

async function runStop(
  instances: DuneInstance[],
  o: StopOptions,
  deps: { interactive?: boolean; confirm?: boolean; survivors?: number[]; killed?: number[]; changed?: number[]; denied?: number[] } = {},
) {
  const lines: string[] = [];
  const stopCalls: { instances: DuneInstance[]; force: boolean }[] = [];
  const priorExit = Deno.exitCode;
  Deno.exitCode = 0;
  try {
    await stopCommand(o, {
      find: () => Promise.resolve(instances),
      stop: (insts, so) => {
        stopCalls.push({ instances: insts, force: so?.force === true });
        const all = insts.flatMap((i) => i.pids);
        return Promise.resolve({
          stopped: all.filter((p) => !(deps.survivors ?? []).includes(p)),
          killed: deps.killed ?? [],
          survivors: deps.survivors ?? [],
          skipped: [],
          changed: deps.changed ?? [],
          denied: deps.denied ?? [],
          needsPermission: [],
        });
      },
      isInteractive: () => deps.interactive ?? false,
      confirm: () => Promise.resolve(deps.confirm ?? false),
      log: (l) => lines.push(l),
    });
    return { text: lines.join("\n"), stopCalls, exitCode: Deno.exitCode };
  } finally {
    Deno.exitCode = priorExit;
  }
}

Deno.test("stopCommand: with no target it prints usage, exits 2 and never scans or stops", async () => {
  let scanned = false;
  const lines: string[] = [];
  const prior = Deno.exitCode;
  try {
    await stopCommand({}, { find: () => { scanned = true; return Promise.resolve(ALL()); }, log: (l) => lines.push(l) });
    assertEquals(Deno.exitCode, 2);
  } finally {
    Deno.exitCode = prior;
  }
  assertEquals(scanned, false);
  assertEquals(lines.join("\n").includes("Usage: dune stop"), true);
});

Deno.test("stopCommand: refuses without --yes when not interactive, and says how to proceed", async () => {
  const { text, stopCalls, exitCode } = await runStop(ALL(), { all: true }, { interactive: false });
  assertEquals(stopCalls.length, 0);
  assertEquals(exitCode, 1);
  assertEquals(text.includes("Re-run with --yes"), true);
});

Deno.test("stopCommand: --yes stops without asking", async () => {
  const { stopCalls, exitCode } = await runStop(ALL(), { all: true, yes: true });
  assertEquals(stopCalls.length, 1);
  assertEquals(stopCalls[0].instances.length, 3);
  assertEquals(exitCode, 0);
});

Deno.test("stopCommand: an interactive 'no' stops nothing, a 'yes' stops", async () => {
  const no = await runStop([IDLE_A()], { all: true }, { interactive: true, confirm: false });
  assertEquals(no.stopCalls.length, 0);
  assertEquals(no.text.includes("Cancelled"), true);
  const yes = await runStop([IDLE_A()], { all: true }, { interactive: true, confirm: true });
  assertEquals(yes.stopCalls.length, 1);
});

Deno.test("stopCommand: shows what it is about to stop, with an instance and process count in the question", async () => {
  const { text } = await runStop(ALL(), { idle: true }, { interactive: false });
  assertEquals(text.includes("Idle A") && text.includes("Idle B"), true);
  assertEquals(text.includes("Live Site"), false, "a listening instance is not even shown for --idle");
  assertEquals(text.includes("Stop 2 idle instances (4 processes)?"), true, text);
});

Deno.test("stopCommand --idle: stops only the idle instances", async () => {
  const { stopCalls } = await runStop(ALL(), { idle: true, yes: true });
  assertEquals(stopCalls[0].instances.map((i) => i.pid), [20, 30]);
});

Deno.test("stopCommand <pid>: stops that one instance only", async () => {
  const { stopCalls } = await runStop(ALL(), { pid: "31", yes: true });
  assertEquals(stopCalls[0].instances.map((i) => i.pid), [30]);
});

Deno.test("stopCommand: --force reaches stopInstances; without it, it does not", async () => {
  assertEquals((await runStop([IDLE_A()], { all: true, yes: true, force: true })).stopCalls[0].force, true);
  assertEquals((await runStop([IDLE_A()], { all: true, yes: true })).stopCalls[0].force, false);
});

Deno.test("stopCommand: a process that ignored SIGTERM is reported with the --force hint and fails the exit code", async () => {
  const { text, exitCode } = await runStop([fakeInstance({ pids: [7, 8] })], { all: true, yes: true }, { survivors: [8] });
  assertEquals(text.includes("Still running (ignored SIGTERM): 8"), true);
  assertEquals(text.includes("Re-run with --force"), true);
  assertEquals(exitCode, 1);
});

Deno.test("stopCommand --force: survivors of SIGKILL are reported as such and fail the exit code", async () => {
  const { text, exitCode } = await runStop([fakeInstance({ pids: [7, 8] })], { all: true, yes: true, force: true }, { survivors: [8] });
  assertEquals(text.includes("Could not stop (still running even after SIGKILL): 8"), true);
  assertEquals(text.includes("Re-run with --force"), false);
  assertEquals(exitCode, 1);
});

Deno.test("stopCommand --force: processes that needed SIGKILL are named, and that alone is not a failure", async () => {
  const { text, exitCode } = await runStop([fakeInstance({ pids: [7, 8] })], { all: true, yes: true, force: true }, { killed: [8] });
  assertEquals(text.includes("1 did not exit on SIGTERM and were killed (SIGKILL): 8"), true);
  assertEquals(exitCode, 0);
});

Deno.test("stopCommand: reports pids that were not signalled because they exited or were reused, and ones that were denied", async () => {
  const changed = await runStop([IDLE_A()], { all: true, yes: true }, { changed: [9] });
  assertEquals(changed.text.includes("Not signalled (already exited, or the pid now belongs to a different process): 9"), true);
  assertEquals(changed.exitCode, 0);
  const denied = await runStop([IDLE_A()], { all: true, yes: true }, { denied: [1] });
  assertEquals(denied.text.includes("Not permitted (owned by another user): 1"), true);
  assertEquals(denied.exitCode, 1);
});

Deno.test("stopCommand: shows the notes (unconfirmed left out) before asking", async () => {
  const stray = fakeInstance({ pid: 70, pids: [70], confirmed: false });
  const { text } = await runStop([IDLE_A(), stray], { all: true }, { interactive: false });
  assertEquals(text.includes("Note: 1 process that only looks like dune"), true, text);
  assertEquals(text.includes("Stop 1 instance (1 process)?"), true);
});

Deno.test("stopCommand: says nothing about SIGKILL when everything exited gracefully", async () => {
  const { text } = await runStop([IDLE_A()], { all: true, yes: true });
  assertEquals(text.includes("SIGKILL"), false);
});

Deno.test("stopCommand: nothing running — exit 0 for --all/--idle, exit 1 when a pid or port was named", async () => {
  assertEquals((await runStop([], { all: true, yes: true })).exitCode, 0);
  assertEquals((await runStop([], { idle: true, yes: true })).exitCode, 0);
  assertEquals((await runStop([], { pid: "5", yes: true })).exitCode, 1);
  assertEquals((await runStop([], { port: "3000", yes: true })).exitCode, 1);
  assertEquals((await runStop([], { all: true, yes: true })).stopCalls.length, 0);
});

Deno.test("stopCommand: a named pid nobody has stops nothing and exits 1", async () => {
  const { text, stopCalls, exitCode } = await runStop(ALL(), { pid: "424242", yes: true });
  assertEquals(stopCalls.length, 0);
  assertEquals(exitCode, 1);
  assertEquals(text.includes("424242"), true);
});

Deno.test("stopCommand --idle: when lsof is unavailable nothing is assumed idle", async () => {
  const unknown = fakeInstance({ pid: 40, pids: [40], portStatus: "unknown" });
  const { stopCalls, exitCode, text } = await runStop([unknown], { idle: true, yes: true });
  assertEquals(stopCalls.length, 0, "an instance of unknown state must not be stopped as 'idle'");
  assertEquals(exitCode, 1);
  assertEquals(text.includes("Can't tell which instances are idle"), true);
});
