/**
 * Shared fixtures for the `dune ps` / `dune stop` tests: small real processes
 * that look like dune servers to the discovery logic (a trivial `main.ts`
 * beside a real `config/site.yaml`), plus a fake instance for flow tests.
 * Not a test file itself.
 */

import { join } from "@std/path";
import type { DuneInstance } from "../../src/cli/instances.ts";

export const opts = { sanitizeOps: false, sanitizeResources: false };

const BOOT_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 100;

/** Poll until `port` accepts a connection, or give up at the timeout. */
export async function waitForPort(port: number): Promise<void> {
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

export async function stop(child: Deno.ChildProcess): Promise<void> {
  try {
    child.kill("SIGTERM");
  } catch {
    // already exited
  }
  await child.status.catch(() => {});
}

export const SERVER = (port: number) => `Deno.serve({ port: ${port}, onListen: () => {} }, () => new Response("ok"));\n`;

export async function makeSite(prefix: string, title: string): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix });
  await Deno.mkdir(join(dir, "config"), { recursive: true });
  await Deno.writeTextFile(join(dir, "config", "site.yaml"), `title: ${title}\n`);
  return dir;
}

export function spawnDeno(args: string[], cwd: string): Deno.ChildProcess {
  return new Deno.Command(Deno.execPath(), {
    args,
    cwd,
    env: { ...Deno.env.toObject(), PWD: cwd },
    stdout: "null",
    stderr: "null",
  }).spawn();
}

/** A `deno task serve` wrapper around `deno run -A main.ts serve`: two processes, one instance. */
export async function startTaskTree(port: number): Promise<{ site: string; child: Deno.ChildProcess }> {
  const site = await makeSite("dune_test_ps_tree_", "Tree Site");
  await Deno.writeTextFile(join(site, "deno.json"), JSON.stringify({ tasks: { serve: "deno run -A main.ts serve" } }));
  await Deno.writeTextFile(join(site, "main.ts"), SERVER(port) + `await new Promise(() => {});\n`);
  const child = spawnDeno(["task", "serve"], site);
  await waitForPort(port);
  return { site, child };
}

export function fakeInstance(overrides: Partial<DuneInstance> = {}): DuneInstance {
  return {
    pid: 99_990,
    pids: [99_990],
    mode: "serve",
    root: "/x/site",
    title: "Fake",
    ports: [],
    portStatus: "not-listening",
    responsive: "unknown",
    version: null,
    elapsed: "01:00",
    command: "deno run -A main.ts serve",
    ...overrides,
  };
}

