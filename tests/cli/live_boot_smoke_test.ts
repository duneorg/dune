/**
 * Live-boot smoke test: actually spawns `dune dev` as a real subprocess and
 * makes a real HTTP request against it.
 *
 * Every other test in this suite exercises Fresh's request handler
 * (`app.handler()`) in-process, which never touches `Builder.listen()` or
 * Fresh's esbuild dev-bundling service — so a regression anywhere in that
 * boot path (a bad `@fresh/core`/esbuild pairing, a crash between "ready"
 * and actually serving) can pass the entire suite with zero indication
 * anything is wrong. Found the hard way on 2026-08-20: `dune dev` crashed
 * immediately after printing ready, on every theme in dune-themes, while
 * `deno task check` and the full test suite stayed green throughout.
 *
 * This test is deliberately narrow: it doesn't assert anything about
 * content or routing (that's covered elsewhere) — only that the process
 * boots, serves a real HTTP response, and doesn't die on its own within the
 * timeout window. `dune serve` shares the same underlying Builder/esbuild
 * integration (`.build()` instead of `.listen()`), so this test's coverage
 * extends to that path too without needing a duplicate.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { join } from "@std/path";

const TSX_PAGE = `
/** @jsxImportSource preact */
export const frontmatter = {
  title: "Smoke Test",
  published: true,
  visible: true,
  layout: false,
};

export default function Home() {
  return <div id="smoke-test">alive</div>;
}
`;

const BOOT_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 250;

Deno.test(
  "live boot smoke test: `dune dev` actually serves a real HTTP request",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    const root = await Deno.makeTempDir({ prefix: "dune_test_live_boot_" });
    const port = 18_842; // arbitrary, unlikely to collide with a real dev server
    let child: Deno.ChildProcess | undefined;
    let output = "";
    let stdoutDone: Promise<void> | undefined;
    let stderrDone: Promise<void> | undefined;

    try {
      await Deno.mkdir(join(root, "content", "01.home"), { recursive: true });
      await Deno.writeTextFile(
        join(root, "content", "01.home", "default.tsx"),
        TSX_PAGE,
      );
      await Deno.mkdir(join(root, "config"), { recursive: true });
      await Deno.writeTextFile(
        join(root, "config", "site.yaml"),
        "title: Smoke Test Site\n",
      );
      // A real site's own deno.json, same shape `dune new` scaffolds. Required:
      // Fresh's Builder reads compilerOptions from *this* root (the value passed
      // to `new Builder({ root })`, not from Deno.cwd() or dune's own config) on
      // the first real build — omit it and every site (real or test fixture)
      // fails with "Could not find a deno.json ... that contains a
      // 'compilerOptions' field" on the first request, after "Fresh ready" has
      // already printed. Found by tracing Fresh's own checkDenoCompilerOptions()
      // in the cached jsr:@fresh/core source.
      await Deno.writeTextFile(
        join(root, "deno.json"),
        JSON.stringify({
          compilerOptions: { jsx: "react-jsx", jsxImportSource: "preact" },
        }),
      );

      // --config points at dune's own deno.json directly (DUNE_CONFIG_APPLIED=1
      // skips cli.ts's own local-source re-exec) so this test manages exactly
      // one process — the re-exec/config-merging machinery itself is covered
      // separately (merge_config_test.ts, workspace_linking_test.ts). This
      // still exercises the real dev.ts -> Builder.listen() -> esbuild path.
      const duneDenoJson = join(import.meta.dirname!, "..", "..", "deno.json");
      const cliPath = join(import.meta.dirname!, "..", "..", "src", "cli.ts");

      const cmd = new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "-A",
          `--config=${duneDenoJson}`,
          cliPath,
          "dev",
          "--root",
          root,
          "--port",
          String(port),
        ],
        env: { ...Deno.env.toObject(), DUNE_CONFIG_APPLIED: "1" },
        stdout: "piped",
        stderr: "piped",
      });
      child = cmd.spawn();

      const drain = async (stream: ReadableStream<Uint8Array>) => {
        const decoder = new TextDecoder();
        for await (const chunk of stream) output += decoder.decode(chunk);
      };
      stdoutDone = drain(child.stdout);
      stderrDone = drain(child.stderr);

      let exited = false;
      let exitCode: number | undefined;
      child.status.then((s) => {
        exited = true;
        exitCode = s.code;
      });

      const deadline = Date.now() + BOOT_TIMEOUT_MS;
      let response: Response | undefined;
      while (Date.now() < deadline) {
        if (exited) break;
        try {
          response = await fetch(`http://localhost:${port}/`, {
            signal: AbortSignal.timeout(2000),
          });
          break;
        } catch {
          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        }
      }

      if (!response) {
        throw new Error(
          `dune dev never served a response within ${BOOT_TIMEOUT_MS}ms ` +
            `(process ${
              exited ? `exited with code ${exitCode}` : "still running"
            }).\n` +
            `--- captured output ---\n${output}`,
        );
      }

      assertEquals(
        response.status,
        200,
        `unexpected status; captured output:\n${output}`,
      );
      const body = await response.text();
      assertStringIncludes(body, "alive");
    } finally {
      if (child) {
        try {
          child.kill("SIGTERM");
        } catch {
          // already exited
        }
        await child.status.catch(() => {});
        // Only safe to await these once the process (and thus its stdout/
        // stderr pipes) has actually closed -- awaiting them earlier, while
        // the server is still serving, would hang forever waiting for EOF.
        await stdoutDone?.catch(() => {});
        await stderrDone?.catch(() => {});
      }
      await Deno.remove(root, { recursive: true }).catch(() => {});
    }
  },
);
