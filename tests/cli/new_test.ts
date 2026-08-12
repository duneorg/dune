/**
 * Regression tests for `dune new`'s scaffold shape — specifically the
 * generated site-entrypoint pattern from plan-site-entrypoint.md: no re-exec,
 * `main.ts` calls the callable `cli()` export directly, and tasks invoke
 * `main.ts` rather than the global `dune` shim or a `jsr:...@X/cli` re-exec.
 */

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { join } from "@std/path";
import { newCommand } from "../../src/cli/new.ts";
import { bootstrap } from "../../src/runtime/bootstrap.ts";

Deno.test("dune new: writes a one-line main.ts calling cli()", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await newCommand(dir);
    const mainTs = await Deno.readTextFile(join(dir, "main.ts"));
    assertStringIncludes(mainTs, 'import { cli } from "@dune/core/cli"');
    assertStringIncludes(mainTs, "await cli({ root: import.meta.dirname })");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dune new: site.yaml declares theme.name matching the scaffolded themes/ directory (regression: rendered with no theme applied at all)", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await newCommand(dir);
    const siteYaml = await Deno.readTextFile(join(dir, "config", "site.yaml"));
    assertStringIncludes(siteYaml, "theme:");
    assertStringIncludes(siteYaml, "name: starter");

    const themeDirExists = await Deno.stat(join(dir, "themes", "starter"))
      .then((s) => s.isDirectory)
      .catch(() => false);
    assertEquals(themeDirExists, true, "themes/starter/ must exist to match the declared theme.name");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test(
  "dune new: a freshly-scaffolded site actually resolves its own theme's template (not the bare no-theme fallback)",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    const dir = await Deno.makeTempDir();
    try {
      await newCommand(dir);
      const ctx = await bootstrap(dir, {});
      const template = await ctx.engine.themes.loadTemplate("default");
      assertEquals(
        template !== null,
        true,
        "loadTemplate(\"default\") returned null — the scaffold's own theme isn't being resolved, " +
          "content would silently render through the bare unstyled fallback instead",
      );
    } finally {
      for (let attempt = 0; ; attempt++) {
        try {
          await Deno.remove(dir, { recursive: true });
          break;
        } catch (err) {
          if (attempt >= 4) throw err;
          await new Promise((r) => setTimeout(r, 50));
        }
      }
    }
  },
);

Deno.test("dune new: tasks invoke main.ts, not the dune shim or a jsr: re-exec", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await newCommand(dir);
    const denoJson = JSON.parse(await Deno.readTextFile(join(dir, "deno.json")));
    for (const task of Object.values(denoJson.tasks) as string[]) {
      assertStringIncludes(task, "main.ts");
      if (task.includes("jsr:")) {
        throw new Error(`task should not reference a jsr: specifier directly: ${task}`);
      }
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dune new: import map includes dune-core's full runtime dependency closure", async () => {
  // With no re-exec, there's no merge step to supply dune-core's own internal
  // imports on top of the site's — the site's map has to carry all of them
  // itself (see plan-site-entrypoint.md's "costs" section). This test is a
  // deliberate tripwire: if dune's own deno.json gains a new runtime import
  // and this scaffold isn't updated to match, a freshly scaffolded site
  // would fail immediately with "not in import map" the moment it touches
  // that code path.
  const dir = await Deno.makeTempDir();
  try {
    await newCommand(dir);
    const denoJson = JSON.parse(await Deno.readTextFile(join(dir, "deno.json")));
    const duneOwn = JSON.parse(await Deno.readTextFile(join("src", "..", "deno.json")));
    const required = Object.keys(duneOwn.imports).filter(
      (k) => k !== "@std/assert" && !k.startsWith("@dune/plugin-admin"),
    );
    const missing = required.filter((k) => !(k in denoJson.imports));
    assertEquals(missing, []);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dune new: .mcp.json invokes main.ts, not a jsr: re-exec", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await newCommand(dir);
    const mcpJson = JSON.parse(await Deno.readTextFile(join(dir, ".mcp.json")));
    const args = mcpJson.mcpServers.dune.args as string[];
    assertEquals(args.some((a) => a.includes("main.ts")), true);
    assertEquals(args.some((a) => a.startsWith("jsr:")), false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
