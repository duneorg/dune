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
import { findDuneInstances } from "../../src/cli/ps.ts";

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
    } finally {
      if (child) await stop(child);
      await Deno.remove(root, { recursive: true }).catch(() => {});
    }
  },
);
