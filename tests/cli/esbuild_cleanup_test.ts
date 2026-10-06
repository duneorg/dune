/**
 * Tests for src/cli/esbuild-cleanup.ts — reaping leaked `esbuild --service`
 * workers across `deno run --watch` in-process restarts (duneorg/dune#22).
 */

import { assertEquals } from "@std/assert";
import { join, toFileUrl } from "@std/path";
import { findOwnEsbuildWorkers } from "../../src/cli/esbuild-cleanup.ts";

const ESBUILD = "/Users/x/Library/Caches/deno/npm/registry.npmjs.org/@esbuild/darwin-arm64/0.25.7/bin/esbuild";

Deno.test("findOwnEsbuildWorkers: picks only direct esbuild --service children of the given pid", () => {
  const ps = [
    `  100     1 deno run -A --watch=main.ts main.ts dev`,
    `  101   100 ${ESBUILD} --service=0.25.7 --ping`,
    `  102   100 ${ESBUILD} --service=0.25.7 --ping`,
    `  200     1 deno run -A other/main.ts dev`,
    `  201   200 ${ESBUILD} --service=0.25.7 --ping`,
    `  103   100 /usr/bin/esbuild-helper --service`,
    `  104   100 ${ESBUILD} --bundle in.ts`,
    `  105   100 grep esbuild --service`,
  ].join("\n");
  assertEquals(findOwnEsbuildWorkers(ps, 100), [101, 102]);
});

Deno.test("findOwnEsbuildWorkers: empty/garbage input yields nothing", () => {
  assertEquals(findOwnEsbuildWorkers("", 100), []);
  assertEquals(findOwnEsbuildWorkers("not ps output\n", 100), []);
});

const POLL_MS = 100;
const STEP_TIMEOUT_MS = 30_000;

async function waitFor(check: () => Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + STEP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function esbuildChildren(ppid: number): Promise<number[]> {
  const { stdout } = await new Deno.Command("ps", { args: ["-eo", "pid=,ppid=,command="], stdout: "piped" })
    .output();
  return findOwnEsbuildWorkers(new TextDecoder().decode(stdout), ppid);
}

Deno.test({
  name: "registerEsbuildWorkerCleanup: --watch restarts no longer accumulate esbuild workers (#22)",
  ignore: Deno.build.os === "windows",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "dune_test_esbuild_watch_" });
    const cleanupUrl = toFileUrl(join(import.meta.dirname!, "..", "..", "src", "cli", "esbuild-cleanup.ts")).href;
    let child: Deno.ChildProcess | undefined;
    let log = "";
    try {
      await Deno.writeTextFile(join(dir, "deno.json"), "{}");
      await Deno.writeTextFile(join(dir, "dep.ts"), "export const v = 0;\n");
      // Same shape as Fresh's dev bundler: a long-lived esbuild service
      // started per runtime instance, never stopped explicitly.
      await Deno.writeTextFile(
        join(dir, "main.ts"),
        `import { v } from "./dep.ts";\n` +
          `import { registerEsbuildWorkerCleanup } from ${JSON.stringify(cleanupUrl)};\n` +
          `registerEsbuildWorkerCleanup();\n` +
          `const esbuild = await import("npm:esbuild@0.25.7");\n` +
          `await esbuild.initialize({});\n` +
          `await esbuild.build({ stdin: { contents: "export const x = 1" }, write: false });\n` +
          `console.log("ready " + v);\n` +
          `setInterval(() => {}, 1000);\n`,
      );

      child = new Deno.Command(Deno.execPath(), {
        args: ["run", "-A", "--watch=main.ts", "main.ts"],
        cwd: dir,
        stdout: "piped",
        stderr: "piped",
      }).spawn();
      const decoder = new TextDecoder();
      const drain = async (s: ReadableStream<Uint8Array>) => {
        for await (const c of s) log += decoder.decode(c);
      };
      const done = Promise.all([drain(child.stdout), drain(child.stderr)]);
      const pid = child.pid;

      await waitFor(async () => log.includes("ready 0"), `first boot\n${log}`);
      for (let i = 1; i <= 3; i++) {
        await Deno.writeTextFile(join(dir, "dep.ts"), `export const v = ${i};\n`);
        await waitFor(async () => log.includes(`ready ${i}`), `restart ${i}\n${log}`);
      }
      // Without the cleanup this is 4 (one leaked worker per restart).
      assertEquals((await esbuildChildren(pid)).length, 1, log);

      child.kill("SIGTERM");
      await child.status;
      await done.catch(() => {});
      child = undefined;
    } finally {
      if (child) {
        try {
          child.kill("SIGKILL");
        } catch { /* already exited */ }
        await child.status.catch(() => {});
      }
      await Deno.remove(dir, { recursive: true }).catch(() => {});
    }
  },
});
