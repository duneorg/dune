/**
 * Tests for `dune ps` discovery (src/cli/instances.ts) and listing
 * (src/cli/ps.ts).
 *
 * Deliberately doesn't spawn a real `dune dev`/`main.ts` process (that's
 * `live_boot_smoke_test.ts`'s job, and it's slow/needs the full bootstrap
 * stack) — these use a trivial fake entrypoint that only needs to *look*
 * like the real thing to the detection logic: a `main.ts` invoked with
 * `dev`/`serve` as the trailing arg, sitting next to a real
 * `config/site.yaml`, optionally binding a real port.
 */

import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { join } from "@std/path";
import {
  type DuneInstance,
  findDuneInstances,
  matchDuneCommand,
  parseRootArg,
  probeResponsive,
} from "../../src/cli/instances.ts";
import { psCommand } from "../../src/cli/ps.ts";
import { fakeInstance, makeSite, opts, SERVER, spawnDeno, startTaskTree, stop, waitForPort } from "./ps_helpers.ts";

/**
 * On macOS, /tmp is a symlink to /private/tmp — Deno.makeTempDir() returns
 * the unresolved path, but the site root discovery reports back (via PWD/lsof,
 * both reflecting the kernel's resolved path) is fully resolved. Compare
 * both sides post-realpath so this symlink hop doesn't look like a bug.
 */
async function realpath(path: string): Promise<string> {
  return await Deno.realPath(path);
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

// ── health probe and registry ────────────────────────────────────────────────

/** Server shape for a listener that accepts TCP connections but never answers HTTP. */
const MUTE_SERVER = (port: number) =>
  `const l = Deno.listen({ port: ${port} });\nsetInterval(() => {}, 1000);\nawait new Promise(() => {});\n`;

const quickProbe = (port: number) => probeResponsive(port, 600);

Deno.test("probeResponsive: a server that answers (even with a 404) is responding", opts, async () => {
  const server = Deno.serve({ port: 18_921, onListen: () => {} }, () => new Response("nope", { status: 404 }));
  try {
    assertEquals(await probeResponsive(18_921, 2000), "responding");
  } finally {
    await server.shutdown();
  }
});

Deno.test("probeResponsive: a listener that never answers, and a closed port, are not responding", opts, async () => {
  const listener = Deno.listen({ port: 18_922 });
  try {
    assertEquals(await probeResponsive(18_922, 500), "not-responding");
  } finally {
    listener.close();
  }
  assertEquals(await probeResponsive(18_923, 500), "not-responding");
});

Deno.test("findDuneInstances: a listening instance that answers is 'responding'; one that accepts but never answers is 'not-responding'", opts, async () => {
  const live = await makeSite("dune_test_ps_resp_", "Responding");
  const mute = await makeSite("dune_test_ps_mute_", "Mute");
  let a: Deno.ChildProcess | undefined;
  let b: Deno.ChildProcess | undefined;
  try {
    await Deno.writeTextFile(join(live, "main.ts"), SERVER(18_924) + `await new Promise(() => {});\n`);
    await Deno.writeTextFile(join(mute, "main.ts"), MUTE_SERVER(18_925));
    a = spawnDeno(["run", "-A", "main.ts", "serve"], live);
    b = spawnDeno(["run", "-A", "main.ts", "serve"], mute);
    await waitForPort(18_924);
    await new Promise((r) => setTimeout(r, 800));

    const found = await findDuneInstances({ probe: quickProbe });
    const ok = found.find((i) => i.pid === a!.pid);
    const bad = found.find((i) => i.pid === b!.pid);
    assertExists(ok);
    assertExists(bad);
    assertEquals(ok.responsive, "responding");
    assertEquals(bad.portStatus, "listening", "it does hold the port");
    assertEquals(bad.responsive, "not-responding");
  } finally {
    if (a) await stop(a);
    if (b) await stop(b);
    await Deno.remove(live, { recursive: true }).catch(() => {});
    await Deno.remove(mute, { recursive: true }).catch(() => {});
  }
});

Deno.test("findDuneInstances: a not-listening instance is not probed ('unknown')", opts, async () => {
  const site = await makeSite("dune_test_ps_noprobe_", "Idle");
  let child: Deno.ChildProcess | undefined;
  try {
    await Deno.writeTextFile(join(site, "main.ts"), `setInterval(() => {}, 1000);\nawait new Promise(() => {});\n`);
    child = spawnDeno(["run", "-A", "main.ts", "serve"], site);
    await new Promise((r) => setTimeout(r, 600));
    const found = (await findDuneInstances({ probe: quickProbe })).find((i) => i.pid === child!.pid);
    assertExists(found);
    assertEquals(found.portStatus, "not-listening");
    assertEquals(found.responsive, "unknown", "nothing to probe without a port");
  } finally {
    if (child) await stop(child);
    await Deno.remove(site, { recursive: true }).catch(() => {});
  }
});

/** Run `body` with DUNE_REGISTRY_DIR pointing at a fresh temp dir (for this process and any child it spawns). */
async function withRegistryDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "dune_test_ps_registry_" });
  const prev = Deno.env.get("DUNE_REGISTRY_DIR");
  Deno.env.set("DUNE_REGISTRY_DIR", dir);
  try {
    await fn(dir);
  } finally {
    if (prev === undefined) Deno.env.delete("DUNE_REGISTRY_DIR");
    else Deno.env.set("DUNE_REGISTRY_DIR", prev);
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
}

const REGISTRY_URL = new URL("../../src/runtime/instance-registry.ts", import.meta.url).href;
// The child imports dune's own source, whose bare specifiers (@std/path) need dune's import map.
const DUNE_CONFIG = new URL("../../deno.json", import.meta.url).pathname;

Deno.test("findDuneInstances: a server whose command line doesn't look like dune is still found, via the registry", opts, async () => {
  await withRegistryDir(async () => {
    const site = await makeSite("dune_test_ps_regonly_", "Registry Only");
    let child: Deno.ChildProcess | undefined;
    try {
      await Deno.writeTextFile(
        join(site, "weird.ts"),
        `import { registerInstance } from ${JSON.stringify(REGISTRY_URL)};\n` +
          `await registerInstance({ mode: "serve", root: ${JSON.stringify(site)}, title: "Registry Only", port: 18926, version: "9.9.9" });\n` +
          SERVER(18_926) + `await new Promise(() => {});\n`,
      );
      child = spawnDeno(["run", "-A", `--config=${DUNE_CONFIG}`, "weird.ts"], site);
      await waitForPort(18_926);
      await new Promise((r) => setTimeout(r, 500));

      const found = (await findDuneInstances({ probe: quickProbe })).find((i) => i.pid === child!.pid);
      assertExists(found, "the registry should reveal a process the command-line matching can't");
      assertEquals(found.version, "9.9.9");
      assertEquals(found.mode, "serve");
      assertEquals(found.root, site);
      assertEquals(found.title, "Registry Only");
      assertEquals(found.ports, [18_926]);
      assertEquals(found.responsive, "responding");
    } finally {
      if (child) await stop(child);
      await Deno.remove(site, { recursive: true }).catch(() => {});
    }
  });
});

Deno.test("findDuneInstances: a registered process that command-line matching also finds appears once, with its version", opts, async () => {
  await withRegistryDir(async () => {
    const site = await makeSite("dune_test_ps_regboth_", "Both");
    let child: Deno.ChildProcess | undefined;
    try {
      await Deno.writeTextFile(
        join(site, "main.ts"),
        `import { registerInstance } from ${JSON.stringify(REGISTRY_URL)};\n` +
          `await registerInstance({ mode: "serve", root: ${JSON.stringify(site)}, title: "Both", port: 18927, version: "1.2.3" });\n` +
          SERVER(18_927) + `await new Promise(() => {});\n`,
      );
      child = spawnDeno(["run", "-A", `--config=${DUNE_CONFIG}`, "main.ts", "serve"], site);
      await waitForPort(18_927);
      await new Promise((r) => setTimeout(r, 500));
      const mine = (await findDuneInstances({ probe: quickProbe })).filter((i) => i.pids.includes(child!.pid));
      assertEquals(mine.length, 1);
      assertEquals(mine[0].version, "1.2.3");
    } finally {
      if (child) await stop(child);
      await Deno.remove(site, { recursive: true }).catch(() => {});
    }
  });
});

Deno.test("findDuneInstances: a stale registry record (process gone) adds nothing", opts, async () => {
  await withRegistryDir(async (dir) => {
    await Deno.writeTextFile(
      join(dir, "999999.json"),
      JSON.stringify({ pid: 999_999, processStart: "Mon Jan  1 00:00:00 2001", mode: "serve", root: "/nowhere", title: null, port: 1, version: "0", registeredAt: "x" }),
    );
    const found = await findDuneInstances({ probe: quickProbe });
    assertEquals(found.some((i) => i.pid === 999_999), false);
  });
});

// ── psCommand output (fakes only: never touches real processes) ──────────────

async function runPs(instances: DuneInstance[]): Promise<string> {
  const lines: string[] = [];
  await psCommand({ find: () => Promise.resolve(instances), log: (l) => lines.push(l) });
  return lines.join("\n");
}

const LIVE = () => fakeInstance({ pid: 10, pids: [10, 11], ports: [3000], portStatus: "listening", title: "Live Site" });
const IDLE = () => fakeInstance({ pid: 20, pids: [20], title: "Idle A" });

Deno.test("psCommand: says 'not listening' for an idle process, a URL for a live one, 'lsof not available' only when unknown", async () => {
  const text = await runPs([
    fakeInstance({ pid: 1, pids: [1], ports: [3000], portStatus: "listening" }),
    fakeInstance({ pid: 2, pids: [2], ports: [], portStatus: "not-listening" }),
    fakeInstance({ pid: 3, pids: [3], ports: [], portStatus: "unknown" }),
  ]);
  assertEquals(text.includes("http://localhost:3000"), true);
  assertEquals(text.includes("not listening (no open port"), true);
  assertEquals(text.includes("port unknown (lsof not available)"), true);
  assertEquals(text.includes("is `lsof` installed?"), false, "the old misleading wording is gone");
  assertEquals(text.includes("3 instances: 1 listening, 1 not listening"), true);
});

Deno.test("psCommand: shows child-process counts and says so when nothing is running", async () => {
  const text = await runPs([LIVE()]);
  assertEquals(text.includes("(+1 child process)"), true);
  assertEquals((await runPs([])).includes("No dune dev/serve instances found"), true);
});

Deno.test("psCommand: flags a listening-but-unresponsive instance, counts it, and shows the version when known", async () => {
  const text = await runPs([
    fakeInstance({ pid: 1, pids: [1], ports: [3000], portStatus: "listening", responsive: "not-responding", version: "0.34.14" }),
    fakeInstance({ pid: 2, pids: [2], ports: [3001], portStatus: "listening", responsive: "responding" }),
  ]);
  assertEquals(text.includes("http://localhost:3000 — NOT RESPONDING"), true);
  assertEquals(text.includes("http://localhost:3001\n") || text.includes("http://localhost:3001"), true);
  assertEquals(text.includes("NOT RESPONDING") && text.split("NOT RESPONDING").length === 2, true, "only the stuck one is flagged");
  assertEquals(text.includes("v0.34.14"), true);
  assertEquals(text.includes("2 instances: 2 listening (1 not responding), 0 not listening"), true, text);
  assertEquals(text.includes("`dune stop --idle`"), true);
});

Deno.test("psCommand: points at `dune stop` when idle instances exist, and only then", async () => {
  const withIdle = await runPs([LIVE(), IDLE()]);
  assertEquals(withIdle.includes("`dune stop --idle` stops only the ones that aren't serving"), true);
  assertEquals((await runPs([LIVE()])).includes("dune stop"), false, "no hint when there is nothing idle");
});
