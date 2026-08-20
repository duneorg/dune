/**
 * End-to-end regression test for backlog item #5 — `dune dev`/`dune serve`
 * should workspace-link sibling plugin packages (`@dune/plugin-admin`,
 * `@dune/plugin-orama`, etc.), not just `@dune/core`.
 *
 * Unlike merge_config_test.ts and local_checkout_detect_test.ts (which
 * cover buildMergedConfig()'s layering and findWorkspaceRoot()'s ancestor
 * walk in isolation), this spawns a real `deno run` against the merged
 * config the way cli.ts's resolveConfig() actually produces it — written
 * as a temp file directly inside the workspace root directory, since Deno
 * rejects a `"workspace"` array whose members aren't nested under the
 * config file's own directory. This proves the merged config's carried-over
 * `"workspace"` field genuinely makes Deno link a `jsr:` specifier to the
 * local sibling checkout, with `--no-remote` ruling out any network access.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { join } from "@std/path";
import { buildMergedConfig } from "../../src/cli/merge-config.ts";
import { findWorkspaceRoot } from "../../src/cli/local-checkout-detect.ts";

Deno.test("resolveConfig()-equivalent flow: merged config workspace-links a sibling package by jsr: specifier", async () => {
  const root = await Deno.makeTempDir();
  try {
    const duneLikeDir = join(root, "dune-like");
    const memberDir = join(root, "member");
    await Deno.mkdir(duneLikeDir, { recursive: true });
    await Deno.mkdir(memberDir, { recursive: true });

    await Deno.writeTextFile(
      join(root, "deno.json"),
      JSON.stringify({ workspace: ["./dune-like", "./member"] }),
    );
    const duneConfigPath = join(duneLikeDir, "deno.json");
    await Deno.writeTextFile(duneConfigPath, JSON.stringify({}));
    await Deno.writeTextFile(
      join(memberDir, "deno.json"),
      JSON.stringify({
        name: "@test-ws/member",
        version: "1.2.3",
        exports: "./mod.ts",
      }),
    );
    await Deno.writeTextFile(
      join(memberDir, "mod.ts"),
      'export const value = "local";',
    );

    // Mirrors resolveConfig(): find the workspace root above the dune-like
    // checkout, then build the merged config with its member list attached.
    const workspaceRoot = await findWorkspaceRoot(duneLikeDir);
    if (!workspaceRoot) throw new Error("expected to find the workspace root");
    const merged = await buildMergedConfig(
      duneConfigPath,
      undefined,
      workspaceRoot,
    );
    assertEquals(merged.workspace, ["./dune-like", "./member"]);

    // Written directly into the workspace root — the whole point of
    // threading workspaceRoot through in the first place.
    const mergedConfigPath = join(root, ".dune-cli-config-test.json");
    await Deno.writeTextFile(mergedConfigPath, JSON.stringify(merged));

    const mainScript = join(root, "main.ts");
    await Deno.writeTextFile(
      mainScript,
      'import { value } from "jsr:@test-ws/member@^1.2.3";\nconsole.log(value);\n',
    );

    const cmd = new Deno.Command(Deno.execPath(), {
      args: ["run", "--no-remote", `--config=${mergedConfigPath}`, mainScript],
      stdout: "piped",
      stderr: "piped",
    });
    const output = await cmd.output();
    const stderr = new TextDecoder().decode(output.stderr);
    assertEquals(output.success, true, `deno run failed:\n${stderr}`);
    assertEquals(new TextDecoder().decode(output.stdout).trim(), "local");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
