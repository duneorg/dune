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
  judgeResponsive,
  type PortProbe,
  probePort,
} from "../../src/cli/instances.ts";
import { psCommand } from "../../src/cli/ps.ts";
import { commandSiteRootHint, parseElapsedSeconds, readProcessTable } from "../../src/cli/instances.ts";
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
    assertEquals(matchDuneCommand(cmd), { mode, strength: "strong", kind: cmd.includes("main.ts") ? "entry" : "cli" }, cmd);
  }
});

Deno.test("matchDuneCommand: `deno task dev|serve` and a bare `cli.ts dev|serve` are only weak matches (they could be any project)", () => {
  assertEquals(matchDuneCommand("deno task serve --port 3100"), { mode: "serve", strength: "weak", kind: "task" });
  assertEquals(matchDuneCommand("/Users/x/.deno/bin/deno task dev"), { mode: "dev", strength: "weak", kind: "task" });
  assertEquals(matchDuneCommand("deno run -A src/cli.ts dev --root ../site"), { mode: "dev", strength: "weak", kind: "cli" });
  assertEquals(matchDuneCommand("deno run -A other-tool/cli.ts serve"), { mode: "serve", strength: "weak", kind: "cli" });
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

Deno.test("parseElapsedSeconds: mm:ss, hh:mm:ss and d-hh:mm:ss", () => {
  assertEquals(parseElapsedSeconds("05:12"), 312);
  assertEquals(parseElapsedSeconds("01:23:45"), 5025);
  assertEquals(parseElapsedSeconds("2-09:03:55"), 2 * 86400 + 9 * 3600 + 3 * 60 + 55);
  assertEquals(parseElapsedSeconds("garbage"), null);
  assertEquals(parseElapsedSeconds(null), null);
});

Deno.test("readProcessTable: carries the owner's uid and a start time for every row, and this process is ours", opts, async () => {
  const table = await readProcessTable();
  const me = table.find((r) => r.pid === Deno.pid);
  assertExists(me);
  assertEquals(me.uid, Deno.uid());
  assertEquals(table.every((r) => Number.isInteger(r.uid) && /\d{4}$/.test(r.started) && /\d:\d\d:\d\d/.test(r.started)), true);
});

Deno.test("findDuneInstances: a site is 'confirmed'; a dune-looking process with no config/site.yaml is not", opts, async () => {
  const site = await makeSite("dune_test_ps_conf_", "Confirmed");
  const bare = await Deno.makeTempDir({ prefix: "dune_test_ps_unconf_" });
  let a: Deno.ChildProcess | undefined;
  let b: Deno.ChildProcess | undefined;
  try {
    for (const dir of [site, bare]) await Deno.writeTextFile(join(dir, "main.ts"), `setInterval(() => {}, 1000);\nawait new Promise(() => {});\n`);
    a = spawnDeno(["run", "-A", "main.ts", "serve"], site);
    b = spawnDeno(["run", "-A", "main.ts", "serve"], bare);
    await new Promise((r) => setTimeout(r, 700));
    const found = await findDuneInstances();
    const withSite = found.find((i) => i.pid === a!.pid);
    const without = found.find((i) => i.pid === b!.pid);
    assertExists(withSite);
    assertExists(without, "still listed — ps shows it — but unconfirmed");
    assertEquals(withSite.confirmed, true);
    assertEquals(without.confirmed, false);
    assertEquals(typeof withSite.ageSeconds, "number");
    assertEquals(Object.keys(withSite.startTimes).map(Number).includes(a.pid), true, "start times recorded for the tree");
  } finally {
    if (a) await stop(a);
    if (b) await stop(b);
    await Deno.remove(site, { recursive: true }).catch(() => {});
    await Deno.remove(bare, { recursive: true }).catch(() => {});
  }
});

Deno.test("commandSiteRootHint: only what the command line itself points at counts, never where the process happens to run", () => {
  const hint = (cmd: string, base: string | null) => {
    const m = matchDuneCommand(cmd);
    return m ? commandSiteRootHint(cmd, m, base) : "NO MATCH";
  };
  // The generated entrypoint: the directory of the main.ts it runs, whatever the cwd.
  assertEquals(hint("deno run -A /sites/a/main.ts serve", "/elsewhere"), "/sites/a");
  assertEquals(hint("deno run -A main.ts serve", "/sites/a"), "/sites/a");
  assertEquals(hint("deno run -A ./web/main.ts dev", "/sites"), "/sites/web");
  assertEquals(hint("deno run -A file:///sites/b/main.ts serve", "/elsewhere"), "/sites/b");
  assertEquals(hint("deno run -A main.ts serve", null), null, "relative path and no cwd: no evidence");
  // --root wins, absolute or relative to the process's directory.
  assertEquals(hint("deno run -A /x/dune/src/cli.ts dev --root /sites/c", "/elsewhere"), "/sites/c");
  assertEquals(hint("deno run -A /x/dune/src/cli.ts dev --root ../d", "/sites/c"), "/sites/d");
  // The dune CLI with no --root works on its cwd.
  assertEquals(hint("deno run -A /x/dune/src/cli.ts dev", "/sites/e"), "/sites/e");
  // A bare `deno task` wrapper carries no evidence of its own.
  assertEquals(hint("deno task serve", "/sites/f"), null);
  // A non-dune cli.ts is a weak match: no evidence from the cwd.
  assertEquals(hint("deno run -A cli.ts serve", "/sites/g"), null);
});

Deno.test("findDuneInstances: an unrelated main.ts run from INSIDE a site directory is not confirmed by the directory alone", opts, async () => {
  const site = await makeSite("dune_test_ps_inside_", "Inside");
  const elsewhere = await Deno.makeTempDir({ prefix: "dune_test_ps_tool_" });
  const own = await makeSite("dune_test_ps_own_", "Own");
  let stray: Deno.ChildProcess | undefined;
  let genuine: Deno.ChildProcess | undefined;
  try {
    const body = `setInterval(() => {}, 1000);\nawait new Promise(() => {});\n`;
    await Deno.writeTextFile(join(elsewhere, "main.ts"), body);
    await Deno.writeTextFile(join(own, "main.ts"), body);
    // Someone's own tool, started from a shell that happens to be sitting in the site repo.
    stray = spawnDeno(["run", "-A", join(elsewhere, "main.ts"), "serve"], site);
    // The site's own entrypoint, started from somewhere else entirely.
    genuine = spawnDeno(["run", "-A", join(own, "main.ts"), "serve"], elsewhere);
    await new Promise((r) => setTimeout(r, 800));
    const found = await findDuneInstances();
    const a = found.find((i) => i.pid === stray!.pid);
    const b = found.find((i) => i.pid === genuine!.pid);
    assertExists(a);
    assertExists(b);
    assertEquals(a.confirmed, false, "running from inside a dune site proves nothing about the process");
    assertEquals(b.confirmed, true, "its main.ts sits in a dune site, wherever it was started from");
    assertEquals(await realpath(b.root!), await realpath(own));
  } finally {
    if (stray) await stop(stray);
    if (genuine) await stop(genuine);
    for (const d of [site, elsewhere, own]) await Deno.remove(d, { recursive: true }).catch(() => {});
  }
});

// ── health probe and registry ────────────────────────────────────────────────

/** Server shape for a listener that accepts TCP connections but never answers HTTP. */
const MUTE_SERVER = (port: number) =>
  `const l = Deno.listen({ port: ${port} });\nsetInterval(() => {}, 1000);\nawait new Promise(() => {});\n`;

const quickProbe = (port: number) => probePort(port, 600);
const fastOpts = { probe: quickProbe, probeAttempts: 2, probeGapMs: 100 };

Deno.test("probePort: dune's own health answer, some other HTTP service, and silence are told apart", opts, async () => {
  const dune = Deno.serve({ port: 18_921, onListen: () => {} }, () => Response.json({ status: "alive" }));
  const other = Deno.serve({ port: 18_928, onListen: () => {} }, () => new Response("nope", { status: 404 }));
  const listener = Deno.listen({ port: 18_922 }); // accepts the connection, never answers
  try {
    assertEquals(await probePort(18_921, 2000), "dune");
    assertEquals(await probePort(18_928, 2000), "other");
    assertEquals(await probePort(18_922, 500), "none");
  } finally {
    listener.close();
    await dune.shutdown();
    await other.shutdown();
  }
  assertEquals(await probePort(18_923, 500), "none", "a closed port");
});

Deno.test("judgeResponsive: one slow or failed probe is not enough; it takes every attempt failing", async () => {
  let calls = 0;
  const flaky = (): Promise<PortProbe> => Promise.resolve(++calls < 3 ? "none" : "dune");
  assertEquals(await judgeResponsive([3000], null, flaky, 3, 1), "responding", "answered on the third attempt");
  assertEquals(calls, 3);
  assertEquals(await judgeResponsive([3000], null, () => Promise.resolve("none"), 3, 1), "not-responding");
});

Deno.test("judgeResponsive: the registered port is the one that counts, and any HTTP answer from it is enough", async () => {
  const probed: number[] = [];
  const probe = (p: number): Promise<PortProbe> => { probed.push(p); return Promise.resolve(p === 10_000 ? "other" : "dune"); };
  // A debugger on 9229 would answer, but the site registered 10000.
  assertEquals(await judgeResponsive([9229, 10_000], 10_000, probe, 1, 1), "responding");
  assertEquals(probed, [10_000], "only the registered port is probed");
});

Deno.test("judgeResponsive: without a registered port every listening port is probed, and only dune's own answer counts", async () => {
  // Hung site on 10000 (silent) + an inspector on 9229 (answers HTTP, not like dune): never "responding".
  const probe = (p: number): Promise<PortProbe> => Promise.resolve(p === 9229 ? "other" : "none");
  assertEquals(await judgeResponsive([9229, 10_000], null, probe, 2, 1), "unknown", "can't tell — not claimed to be hung");
  // Healthy site on 10000 alongside the inspector.
  const healthy = (p: number): Promise<PortProbe> => Promise.resolve(p === 9229 ? "other" : "dune");
  assertEquals(await judgeResponsive([9229, 10_000], null, healthy, 2, 1), "responding");
  assertEquals(await judgeResponsive([], null, healthy), "unknown", "nothing listening, nothing to probe");
});

Deno.test("findDuneInstances: a listening instance that answers is 'responding'; one that accepts but never answers is 'not-responding'", opts, async () => {
  const live = await makeSite("dune_test_ps_resp_", "Responding");
  const mute = await makeSite("dune_test_ps_mute_", "Mute");
  let a: Deno.ChildProcess | undefined;
  let b: Deno.ChildProcess | undefined;
  try {
    await Deno.writeTextFile(join(live, "main.ts"), `Deno.serve({ port: 18924, onListen: () => {} }, () => Response.json({ status: "alive" }));\nawait new Promise(() => {});\n`);
    await Deno.writeTextFile(join(mute, "main.ts"), MUTE_SERVER(18_925));
    a = spawnDeno(["run", "-A", "main.ts", "serve"], live);
    b = spawnDeno(["run", "-A", "main.ts", "serve"], mute);
    await waitForPort(18_924);
    await new Promise((r) => setTimeout(r, 800));

    const found = await findDuneInstances(fastOpts);
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
    const found = (await findDuneInstances(fastOpts)).find((i) => i.pid === child!.pid);
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

      const found = (await findDuneInstances(fastOpts)).find((i) => i.pid === child!.pid);
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
      const mine = (await findDuneInstances(fastOpts)).filter((i) => i.pids.includes(child!.pid));
      assertEquals(mine.length, 1);
      assertEquals(mine[0].version, "1.2.3");
    } finally {
      if (child) await stop(child);
      await Deno.remove(site, { recursive: true }).catch(() => {});
    }
  });
});

Deno.test("findDuneInstances: a registered process is confirmed even though its command line says nothing about a site", opts, async () => {
  await withRegistryDir(async () => {
    const site = await makeSite("dune_test_ps_regconf_", "Registered");
    const elsewhere = await Deno.makeTempDir({ prefix: "dune_test_ps_regconf_tool_" });
    let child: Deno.ChildProcess | undefined;
    try {
      await Deno.writeTextFile(
        join(elsewhere, "main.ts"),
        `import { registerInstance } from ${JSON.stringify(REGISTRY_URL)};\n` +
          `await registerInstance({ mode: "serve", root: ${JSON.stringify(site)}, title: "Registered", port: null, version: "3.2.1" });\n` +
          `setInterval(() => {}, 1000);\nawait new Promise(() => {});\n`,
      );
      // Started from a directory with no site, from a script outside any site: unconfirmed by its command line.
      child = spawnDeno(["run", "-A", `--config=${DUNE_CONFIG}`, join(elsewhere, "main.ts"), "serve"], elsewhere);
      await new Promise((r) => setTimeout(r, 1200));
      const found = (await findDuneInstances(fastOpts)).find((i) => i.pid === child!.pid);
      assertExists(found);
      assertEquals(found.confirmed, true, "the process itself says it is a dune site");
      assertEquals(found.version, "3.2.1");
    } finally {
      if (child) await stop(child);
      await Deno.remove(site, { recursive: true }).catch(() => {});
      await Deno.remove(elsewhere, { recursive: true }).catch(() => {});
    }
  });
});

Deno.test("findDuneInstances: a stale registry record (process gone) adds nothing", opts, async () => {
  await withRegistryDir(async (dir) => {
    await Deno.writeTextFile(
      join(dir, "999999.json"),
      JSON.stringify({ pid: 999_999, processStart: "Mon Jan  1 00:00:00 2001", mode: "serve", root: "/nowhere", title: null, port: 1, version: "0", registeredAt: "x" }),
    );
    const found = await findDuneInstances(fastOpts);
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

Deno.test("psCommand: marks an unconfirmed instance as such", async () => {
  const text = await runPs([fakeInstance({ pid: 9, pids: [9], confirmed: false })]);
  assertEquals(text.includes("not confirmed as a dune site"), true);
  assertEquals((await runPs([fakeInstance()])).includes("not confirmed"), false);
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
