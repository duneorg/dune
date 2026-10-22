/**
 * `dune serve` must exit after a graceful shutdown, whatever plugins left
 * running.
 *
 * Graceful shutdown closes the listener and prints "shutdown complete", but
 * serveCommand() used to just return, so the process lived only as long as the
 * event loop had work. One plugin timer that was never unref'd (plugin-admin's
 * collab eviction interval, until 3.1.3) kept it alive forever: an "idle" dune
 * process with no port, at 0% CPU, that a single SIGTERM never ended.
 *
 * Runs the real `serve` command as a subprocess. The plugin below holds a
 * ref'd timer on purpose, standing in for any plugin that does, so this test
 * does not depend on which plugin-admin version is installed.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { dirname, join } from "@std/path";

const PORT = 18_952;
const READY_TIMEOUT_MS = 60_000;
const EXIT_TIMEOUT_MS = 15_000;

const files: Record<string, string> = {
  "config/site.yaml": "title: Exit Test\nurl: http://localhost:18952\nplugins:\n  - src: ./plugins/hold.ts\n",
  // Fresh reads compilerOptions from the site root on the first build.
  "deno.json": JSON.stringify({ compilerOptions: { jsx: "react-jsx", jsxImportSource: "preact" } }),
  "content/01.home/default.md": "---\ntitle: Home\n---\nhi\n",
  // A plugin whose timer is ref'd and never cleared.
  "plugins/hold.ts": `setInterval(() => {}, 3_600_000);\nexport default { name: "hold", version: "1.0.0", hooks: {} };\n`,
};

Deno.test({
  name: "dune serve exits after SIGTERM even when a plugin holds a ref'd timer",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const root = await Deno.makeTempDir({ prefix: "dune_test_serve_exit_" });
    let child: Deno.ChildProcess | undefined;
    let output = "";
    let drains: Promise<unknown> | undefined;
    try {
      for (const [rel, text] of Object.entries(files)) {
        await Deno.mkdir(dirname(join(root, rel)), { recursive: true });
        await Deno.writeTextFile(join(root, rel), text);
      }
      const duneDenoJson = join(import.meta.dirname!, "..", "..", "deno.json");
      const cliPath = join(import.meta.dirname!, "..", "..", "src", "cli.ts");

      child = new Deno.Command(Deno.execPath(), {
        args: ["run", "-A", `--config=${duneDenoJson}`, cliPath, "serve", "--root", root, "--port", String(PORT)],
        env: { ...Deno.env.toObject(), DUNE_CONFIG_APPLIED: "1" },
        stdout: "piped",
        stderr: "piped",
      }).spawn();
      const decoder = new TextDecoder();
      const drain = async (s: ReadableStream<Uint8Array>) => {
        for await (const c of s) output += decoder.decode(c);
      };
      drains = Promise.all([drain(child.stdout), drain(child.stderr)]);

      // Ready?
      let ready = false;
      const readyDeadline = Date.now() + READY_TIMEOUT_MS;
      while (Date.now() < readyDeadline) {
        try {
          const res = await fetch(`http://localhost:${PORT}/`, { signal: AbortSignal.timeout(1500) });
          await res.body?.cancel();
          ready = true;
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 250));
        }
      }
      assertEquals(ready, true, `server never came up:\n${output}`);

      // One SIGTERM, as a service manager or a plain `kill` would send.
      child.kill("SIGTERM");
      const outcome = await Promise.race([
        child.status.then((s) => ({ exited: true as const, code: s.code })),
        new Promise<{ exited: false }>((r) => setTimeout(() => r({ exited: false }), EXIT_TIMEOUT_MS)),
      ]);

      assertEquals(
        outcome.exited,
        true,
        `process was still alive ${EXIT_TIMEOUT_MS}ms after SIGTERM (a ref'd plugin timer kept it running):\n${output}`,
      );
      assertEquals((outcome as { code: number }).code, 0);
      assertEquals(output.includes("shutdown complete"), true, output);
      child = undefined;
    } finally {
      if (child) {
        try {
          child.kill("SIGKILL");
        } catch { /* already gone */ }
        await child.status.catch(() => {});
      }
      await drains?.catch(() => {});
      await Deno.remove(root, { recursive: true }).catch(() => {});
    }
  },
});
