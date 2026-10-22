/**
 * Tests for `dune ps` (src/cli/ps.ts) — finding dune dev/serve instances
 * already running on the machine.
 *
 * Deliberately doesn't spawn a real `dune dev`/`main.ts` process (that's
 * `live_boot_smoke_test.ts`'s job, and it's slow/needs the full bootstrap
 * stack) — these use a trivial fake entrypoint that only needs to *look*
 * like the real thing to `dune ps`'s own detection logic: a `main.ts`
 * invoked with `dev`/`serve` as the trailing arg, sitting next to a real
 * `config/site.yaml`, optionally binding a real port. That's the actual
 * surface `findDuneInstances()` operates on.
 */

import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { join } from "@std/path";
import {
  type DuneInstance,
  findDuneInstances,
  matchDuneCommand,
  parseRootArg,
  psCommand,
  stopInstances,
} from "../../src/cli/ps.ts";

const BOOT_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 100;

/**
 * On macOS, /tmp is a symlink to /private/tmp — Deno.makeTempDir() returns
 * the unresolved path, but the site root ps.ts reports back (via PWD/lsof,
 * both reflecting the kernel's resolved path) is fully resolved. Compare
 * both sides post-realpath so this symlink hop doesn't look like a bug.
 */
async function realpath(path: string): Promise<string> {
  return await Deno.realPath(path);
}

/** Poll until `port` accepts a connection, or give up at the timeout. */
async function waitForPort(port: number): Promise<void> {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(500) });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  }
  throw new Error(`nothing answered on port ${port} within ${BOOT_TIMEOUT_MS}ms`);
}

async function stop(child: Deno.ChildProcess): Promise<void> {
  try {
    child.kill("SIGTERM");
  } catch {
    // already exited
  }
  await child.status.catch(() => {});
}

Deno.test(
  "findDuneInstances: finds a dev-shaped process via its live cwd, reads title and port",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    const root = await Deno.makeTempDir({ prefix: "dune_test_ps_livecwd_" });
    const port = 18_901;
    let child: Deno.ChildProcess | undefined;

    try {
      await Deno.mkdir(join(root, "config"), { recursive: true });
      await Deno.writeTextFile(join(root, "config", "site.yaml"), "title: PS Test Site\n");
      await Deno.writeTextFile(
        join(root, "main.ts"),
        `Deno.serve({ port: ${port} }, () => new Response("ok"));\n` +
          `await new Promise(() => {});\n`,
      );

      const cmd = new Deno.Command(Deno.execPath(), {
        args: ["run", "-A", "main.ts", "dev"],
        cwd: root,
        stdout: "null",
        stderr: "null",
      });
      child = cmd.spawn();
      const pid = child.pid;
      await waitForPort(port);

      const instances = await findDuneInstances();
      const found = instances.find((i) => i.pid === pid);
      assertExists(found, `no instance found for pid ${pid}`);
      assertEquals(found.mode, "dev");
      assertEquals(found.title, "PS Test Site");
      assertEquals(found.root, await realpath(root));
      assertEquals(found.ports, [port]);
    } finally {
      if (child) await stop(child);
      await Deno.remove(root, { recursive: true }).catch(() => {});
    }
  },
);

Deno.test(
  "findDuneInstances: prefers PWD over live cwd when the process chdir'd internally",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    // Mirrors dev.ts's own real behavior: it Deno.chdir()s to dune's own
    // package root (for Fresh's esbuild import-map auto-detection) when
    // running from a local checkout, which would make a naive live-cwd
    // lookup report the wrong directory. A real shell launch always sets
    // PWD to the directory the command was actually run from; this test
    // sets it explicitly since Deno.Command doesn't go through a shell.
    const siteRoot = await Deno.makeTempDir({ prefix: "dune_test_ps_pwd_site_" });
    const decoyRoot = await Deno.makeTempDir({ prefix: "dune_test_ps_pwd_decoy_" });
    const port = 18_902;
    let child: Deno.ChildProcess | undefined;

    try {
      await Deno.mkdir(join(siteRoot, "config"), { recursive: true });
      await Deno.writeTextFile(join(siteRoot, "config", "site.yaml"), "title: Chdir Test Site\n");
      // No config/site.yaml here — this is what a naive live-cwd check
      // would find instead, if PWD weren't preferred.
      await Deno.writeTextFile(
        join(siteRoot, "main.ts"),
        `Deno.chdir(${JSON.stringify(decoyRoot)});\n` +
          `Deno.serve({ port: ${port} }, () => new Response("ok"));\n` +
          `await new Promise(() => {});\n`,
      );

      const cmd = new Deno.Command(Deno.execPath(), {
        args: ["run", "-A", "main.ts", "dev"],
        cwd: siteRoot,
        env: { ...Deno.env.toObject(), PWD: siteRoot },
        stdout: "null",
        stderr: "null",
      });
      child = cmd.spawn();
      const pid = child.pid;
      await waitForPort(port);

      const instances = await findDuneInstances();
      const found = instances.find((i) => i.pid === pid);
      assertExists(found, `no instance found for pid ${pid}`);
      assertEquals(found.title, "Chdir Test Site");
      // PWD (unlike the live-cwd/lsof path in the previous test) is taken
      // verbatim from the env var we set below — not kernel-resolved — so
      // no realpath() needed here.
      assertEquals(found.root, siteRoot);
      assertEquals(found.ports, [port]);
    } finally {
      if (child) await stop(child);
      await Deno.remove(siteRoot, { recursive: true }).catch(() => {});
      await Deno.remove(decoyRoot, { recursive: true }).catch(() => {});
    }
  },
);

Deno.test(
  "findDuneInstances: a main.ts serve-shaped process is reported as mode 'serve'",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    const root = await Deno.makeTempDir({ prefix: "dune_test_ps_serve_mode_" });
    const port = 18_903;
    let child: Deno.ChildProcess | undefined;

    try {
      await Deno.mkdir(join(root, "config"), { recursive: true });
      await Deno.writeTextFile(join(root, "config", "site.yaml"), "title: Serve Mode Site\n");
      await Deno.writeTextFile(
        join(root, "main.ts"),
        `Deno.serve({ port: ${port} }, () => new Response("ok"));\n` +
          `await new Promise(() => {});\n`,
      );

      const cmd = new Deno.Command(Deno.execPath(), {
        args: ["run", "-A", "main.ts", "serve"],
        cwd: root,
        stdout: "null",
        stderr: "null",
      });
      child = cmd.spawn();
      const pid = child.pid;
      await waitForPort(port);

      const instances = await findDuneInstances();
      const found = instances.find((i) => i.pid === pid);
      assertExists(found, `no instance found for pid ${pid}`);
      assertEquals(found.mode, "serve");
    } finally {
      if (child) await stop(child);
      await Deno.remove(root, { recursive: true }).catch(() => {});
    }
  },
);

Deno.test(
  "findDuneInstances: an unrelated main.ts with no config/site.yaml is not reported as a confirmed site, but still shows up",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    const root = await Deno.makeTempDir({ prefix: "dune_test_ps_not_a_site_" });
    let child: Deno.ChildProcess | undefined;

    try {
      // No config/ dir at all — some other project that happens to name
      // its entrypoint main.ts and take a "dev" argument. Needs a live
      // timer, not just an unresolved promise — Deno detects a top-level
      // await with nothing else scheduled ("promise never resolved") and
      // exits immediately.
      await Deno.writeTextFile(
        join(root, "main.ts"),
        `setInterval(() => {}, 1000);\n` +
          `await new Promise(() => {});\n`,
      );

      const cmd = new Deno.Command(Deno.execPath(), {
        args: ["run", "-A", "main.ts", "dev"],
        cwd: root,
        stdout: "null",
        stderr: "null",
      });
      child = cmd.spawn();
      const pid = child.pid;
      // No port to wait on here — give it a moment to actually start.
      await new Promise((r) => setTimeout(r, 500));

      const instances = await findDuneInstances();
      const found = instances.find((i) => i.pid === pid);
      assertExists(found, `no instance found for pid ${pid}`);
      assertEquals(found.root, null);
      assertEquals(found.title, null);
      assertEquals(found.portStatus, "not-listening");
    } finally {
      if (child) await stop(child);
      await Deno.remove(root, { recursive: true }).catch(() => {});
    }
  },
);

// ── command matching (pure) ──────────────────────────────────────────────────

Deno.test("matchDuneCommand: the generated entrypoint, the dune CLI and jsr forms are strong matches", () => {
  const strong: [string, "dev" | "serve"][] = [
    ["deno run -A main.ts dev", "dev"],
    ["deno run -A --watch=main.ts main.ts dev --port 4700", "dev"],
    ["/Users/x/.deno/bin/deno run -A main.ts serve --root . --port 8191", "serve"],
    ["/Users/x/.deno/bin/deno run --allow-all --config /Users/x/.deno/bin/.dune/deno.json file:///Users/x/claude/dune/src/cli.ts dev", "dev"],
    ["/Users/x/.deno/bin/deno run -A jsr:@dune/core@0.34.10/cli serve --env-file --port 3100", "serve"],
    ["/Users/x/.deno/bin/deno run -A --config=/tmp/c.json --no-lock https://jsr.io/@dune/core/0.34.10/src/cli.ts serve --env-file", "serve"],
  ];
  for (const [cmd, mode] of strong) {
    assertEquals(matchDuneCommand(cmd), { mode, strength: "strong" }, cmd);
  }
});

Deno.test("matchDuneCommand: `deno task dev|serve` and a bare `cli.ts dev|serve` are only weak matches (they could be any project)", () => {
  assertEquals(matchDuneCommand("deno task serve --port 3100"), { mode: "serve", strength: "weak" });
  assertEquals(matchDuneCommand("/Users/x/.deno/bin/deno task dev"), { mode: "dev", strength: "weak" });
  assertEquals(matchDuneCommand("deno run -A src/cli.ts dev --root ../site"), { mode: "dev", strength: "weak" });
  assertEquals(matchDuneCommand("deno run -A other-tool/cli.ts serve"), { mode: "serve", strength: "weak" });
});

Deno.test("matchDuneCommand: unrelated commands do not match", () => {
  for (
    const cmd of [
      "deno run -A src/cli.ts ps", // dune, but not a server
      "deno run -A src/cli.ts ps --stop",
      "node server.js serve",
      "/bin/zsh -c deno run -A main.ts dev", // a shell *containing* the text, not deno itself
      "deno lint src/",
      "deno test -A tests/",
    ]
  ) {
    assertEquals(matchDuneCommand(cmd), null, cmd);
  }
});

Deno.test("parseRootArg: --root in both spellings, quoted or not", () => {
  assertEquals(parseRootArg("deno run cli.ts dev --root /a/b --port 3000"), "/a/b");
  assertEquals(parseRootArg("deno run cli.ts dev --root=/a/b"), "/a/b");
  assertEquals(parseRootArg('deno run cli.ts dev --root "/a b/c"'), "/a b/c");
  assertEquals(parseRootArg("deno run cli.ts dev --port 3000"), null);
});

// ── fixtures for the new real-process tests ──────────────────────────────────

const SERVER = (port: number) => `Deno.serve({ port: ${port}, onListen: () => {} }, () => new Response("ok"));\n`;

async function makeSite(prefix: string, title: string): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix });
  await Deno.mkdir(join(dir, "config"), { recursive: true });
  await Deno.writeTextFile(join(dir, "config", "site.yaml"), `title: ${title}\n`);
  return dir;
}

function spawnDeno(args: string[], cwd: string): Deno.ChildProcess {
  return new Deno.Command(Deno.execPath(), {
    args,
    cwd,
    env: { ...Deno.env.toObject(), PWD: cwd },
    stdout: "null",
    stderr: "null",
  }).spawn();
}

const opts = { sanitizeOps: false, sanitizeResources: false };

Deno.test("findDuneInstances: the dune CLI run directly (`cli.ts dev --root <site>`) is found, root from --root", opts, async () => {
  // "dune" must appear in the command line for a bare `cli.ts dev` to count.
  const toolDir = await Deno.makeTempDir({ prefix: "dune_test_ps_shim_tool_" });
  const site = await makeSite("dune_test_ps_shim_site_", "Shim Site");
  const port = 18_911;
  let child: Deno.ChildProcess | undefined;
  try {
    await Deno.writeTextFile(join(toolDir, "cli.ts"), SERVER(port) + `await new Promise(() => {});\n`);
    child = spawnDeno(["run", "-A", join(toolDir, "cli.ts"), "dev", "--root", site], toolDir);
    const pid = child.pid;
    await waitForPort(port);

    const found = (await findDuneInstances()).find((i) => i.pid === pid);
    assertExists(found, `no instance for pid ${pid}`);
    assertEquals(found.mode, "dev");
    assertEquals(found.root, site); // the explicit --root, as given
    assertEquals(found.title, "Shim Site");
    assertEquals(found.ports, [port]);
    assertEquals(found.portStatus, "listening");
  } finally {
    if (child) await stop(child);
    await Deno.remove(toolDir, { recursive: true }).catch(() => {});
    await Deno.remove(site, { recursive: true }).catch(() => {});
  }
});

Deno.test("findDuneInstances: a relative --root resolves against the process's own directory", opts, async () => {
  const parent = await Deno.makeTempDir({ prefix: "dune_test_ps_relroot_" });
  const port = 18_912;
  let child: Deno.ChildProcess | undefined;
  try {
    await Deno.mkdir(join(parent, "mysite", "config"), { recursive: true });
    await Deno.writeTextFile(join(parent, "mysite", "config", "site.yaml"), "title: Relative\n");
    await Deno.writeTextFile(join(parent, "cli.ts"), SERVER(port) + `await new Promise(() => {});\n`);
    child = spawnDeno(["run", "-A", "cli.ts", "serve", "--root", "mysite"], parent);
    const pid = child.pid;
    await waitForPort(port);

    const found = (await findDuneInstances()).find((i) => i.pid === pid);
    assertExists(found, `no instance for pid ${pid}`);
    assertEquals(found.title, "Relative");
    assertEquals(found.root, join(parent, "mysite"));
  } finally {
    if (child) await stop(child);
    await Deno.remove(parent, { recursive: true }).catch(() => {});
  }
});

Deno.test("findDuneInstances: a process that matches but holds no port is 'not-listening', with its root confirmed", opts, async () => {
  const site = await makeSite("dune_test_ps_idle_", "Idle Site");
  let child: Deno.ChildProcess | undefined;
  try {
    await Deno.writeTextFile(join(site, "main.ts"), `setInterval(() => {}, 1000);\nawait new Promise(() => {});\n`);
    child = spawnDeno(["run", "-A", "main.ts", "serve"], site);
    const pid = child.pid;
    await new Promise((r) => setTimeout(r, 600));

    const found = (await findDuneInstances()).find((i) => i.pid === pid);
    assertExists(found, `no instance for pid ${pid}`);
    assertEquals(found.root, site);
    assertEquals(found.title, "Idle Site");
    assertEquals(found.ports, []);
    assertEquals(found.portStatus, "not-listening");
  } finally {
    if (child) await stop(child);
    await Deno.remove(site, { recursive: true }).catch(() => {});
  }
});

/** A `deno task serve` wrapper around `deno run -A main.ts serve`: two processes, one instance. */
async function startTaskTree(port: number): Promise<{ site: string; child: Deno.ChildProcess }> {
  const site = await makeSite("dune_test_ps_tree_", "Tree Site");
  await Deno.writeTextFile(join(site, "deno.json"), JSON.stringify({ tasks: { serve: "deno run -A main.ts serve" } }));
  await Deno.writeTextFile(join(site, "main.ts"), SERVER(port) + `await new Promise(() => {});\n`);
  const child = spawnDeno(["task", "serve"], site);
  await waitForPort(port);
  return { site, child };
}

Deno.test("findDuneInstances: a `deno task` wrapper and its child are ONE instance, reported at the wrapper", opts, async () => {
  const port = 18_913;
  const { site, child } = await startTaskTree(port);
  try {
    const instances = await findDuneInstances();
    const mine = instances.filter((i) => i.pids.includes(child.pid));
    assertEquals(mine.length, 1, "the tree must appear exactly once");
    const found = mine[0];
    assertEquals(found.pid, child.pid, "reported at the topmost process");
    assertEquals(found.pids.length >= 2, true, "includes the child process");
    assertEquals(found.ports, [port], "port found through the child");
    assertEquals(found.title, "Tree Site");
    // ...and the child is not listed again on its own.
    assertEquals(instances.filter((i) => found.pids.slice(1).includes(i.pid)).length, 0);
  } finally {
    await stop(child);
    await Deno.remove(site, { recursive: true }).catch(() => {});
  }
});

Deno.test("stopInstances: stops the whole tree and reports nothing left", opts, async () => {
  const port = 18_914;
  const { site, child } = await startTaskTree(port);
  try {
    const found = (await findDuneInstances()).find((i) => i.pids.includes(child.pid));
    assertExists(found);
    const result = await stopInstances([found], { timeoutMs: 8000 });
    assertEquals(result.survivors, []);
    assertEquals(result.skipped, []);
    assertEquals(result.stopped.sort(), [...found.pids].sort());
    // Really gone: nothing answers any more.
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

function fakeInstance(overrides: Partial<DuneInstance> = {}): DuneInstance {
  return {
    pid: 99_990,
    pids: [99_990],
    mode: "serve",
    root: "/x/site",
    title: "Fake",
    ports: [],
    portStatus: "not-listening",
    elapsed: "01:00",
    command: "deno run -A main.ts serve",
    ...overrides,
  };
}

Deno.test("stopInstances: never signals this process, even if an instance lists it", async () => {
  const result = await stopInstances([fakeInstance({ pids: [Deno.pid] })], { timeoutMs: 300 });
  assertEquals(result.skipped, [Deno.pid]);
  assertEquals(result.stopped, []);
  assertEquals(result.survivors, []);
  // (If it had signalled itself, this assertion would never run.)
});

// ── psCommand flow (fakes only: these never touch real processes) ────────────

async function runPs(
  instances: DuneInstance[],
  opts: { stop?: boolean; yes?: boolean },
  deps: { interactive?: boolean; confirm?: boolean; survivors?: number[] } = {},
) {
  const lines: string[] = [];
  const stopCalls: DuneInstance[][] = [];
  const priorExit = Deno.exitCode;
  Deno.exitCode = 0;
  try {
    await psCommand(opts, {
      find: () => Promise.resolve(instances),
      stop: (insts) => {
        stopCalls.push(insts);
        const all = insts.flatMap((i) => i.pids);
        return Promise.resolve({
          stopped: all.filter((p) => !(deps.survivors ?? []).includes(p)),
          survivors: deps.survivors ?? [],
          skipped: [],
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

Deno.test("psCommand: says 'not listening' for an idle process, a URL for a live one, 'lsof not available' only when unknown", async () => {
  const { text } = await runPs([
    fakeInstance({ pid: 1, pids: [1], ports: [3000], portStatus: "listening" }),
    fakeInstance({ pid: 2, pids: [2], ports: [], portStatus: "not-listening" }),
    fakeInstance({ pid: 3, pids: [3], ports: [], portStatus: "unknown" }),
  ], {});
  assertEquals(text.includes("http://localhost:3000"), true);
  assertEquals(text.includes("not listening (no open port"), true);
  assertEquals(text.includes("port unknown (lsof not available)"), true);
  assertEquals(text.includes("is `lsof` installed?"), false, "the old misleading wording is gone");
  assertEquals(text.includes("3 instances: 1 listening, 1 not listening"), true);
});

Deno.test("psCommand: without --stop it never stops anything", async () => {
  const { stopCalls } = await runPs([fakeInstance()], {});
  assertEquals(stopCalls.length, 0);
});

Deno.test("psCommand --stop: refuses without --yes when not interactive, and says how to proceed", async () => {
  const { text, stopCalls, exitCode } = await runPs([fakeInstance()], { stop: true }, { interactive: false });
  assertEquals(stopCalls.length, 0);
  assertEquals(exitCode, 1);
  assertEquals(text.includes("Re-run with --yes"), true);
});

Deno.test("psCommand --stop: --yes stops without asking", async () => {
  const { stopCalls, exitCode } = await runPs([fakeInstance(), fakeInstance({ pid: 5, pids: [5, 6] })], { stop: true, yes: true });
  assertEquals(stopCalls.length, 1);
  assertEquals(stopCalls[0].length, 2);
  assertEquals(exitCode, 0);
});

Deno.test("psCommand --stop: an interactive 'no' stops nothing, a 'yes' stops everything", async () => {
  const no = await runPs([fakeInstance()], { stop: true }, { interactive: true, confirm: false });
  assertEquals(no.stopCalls.length, 0);
  assertEquals(no.text.includes("Cancelled"), true);
  const yes = await runPs([fakeInstance()], { stop: true }, { interactive: true, confirm: true });
  assertEquals(yes.stopCalls.length, 1);
});

Deno.test("psCommand --stop: survivors are reported and make the exit code non-zero", async () => {
  const { text, exitCode } = await runPs([fakeInstance({ pids: [7, 8] })], { stop: true, yes: true }, { survivors: [8] });
  assertEquals(text.includes("Still running after SIGTERM: 8"), true);
  assertEquals(exitCode, 1);
});

Deno.test("findDuneInstances: a bare `cli.ts serve` with NO site anywhere is not reported (weak matches need a confirmed site)", opts, async () => {
  const dir = await Deno.makeTempDir({ prefix: "ps_test_nosite_" }); // no "dune" in the command, no config/site.yaml
  let child: Deno.ChildProcess | undefined;
  try {
    await Deno.writeTextFile(join(dir, "cli.ts"), `setInterval(() => {}, 1000);\nawait new Promise(() => {});\n`);
    child = spawnDeno(["run", "-A", "cli.ts", "serve"], dir);
    const pid = child.pid;
    await new Promise((r) => setTimeout(r, 600));
    assertEquals((await findDuneInstances()).some((i) => i.pids.includes(pid)), false);
  } finally {
    if (child) await stop(child);
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
});
