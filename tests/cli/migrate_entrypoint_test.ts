/**
 * Tests for `dune migrate:entrypoint` — the codemod that moves an existing
 * site from the re-exec path onto the generated main.ts entrypoint pattern.
 * See migrate-entrypoint.ts's module doc for the ordering invariant this
 * pins: main.ts is written and typechecked BEFORE tasks are ever rewritten.
 */

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { join } from "@std/path";
import { migrateEntrypointCommand } from "../../src/cli/migrate-entrypoint.ts";
import { MAIN_TS_TEMPLATE } from "../../src/cli/entrypoint-template.ts";

/** A pre-migration site: old-style deno.json, no main.ts. */
async function makeLegacySite(): Promise<string> {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(
    join(dir, "deno.json"),
    JSON.stringify({
      imports: {
        "preact": "npm:preact@^10",
        "@dune/core": "jsr:@dune/core@^0.29",
      },
      tasks: {
        dev: "dune dev",
        build: "dune build",
        serve: "dune serve",
      },
    }),
  );
  return dir;
}

Deno.test("migrate:entrypoint: writes main.ts and rewrites tasks", async () => {
  const dir = await makeLegacySite();
  try {
    const result = await migrateEntrypointCommand(dir);
    assertEquals(result.migrated, true);
    assertEquals(result.rewroteTasks, true);

    const mainTs = await Deno.readTextFile(join(dir, "main.ts"));
    assertEquals(mainTs, MAIN_TS_TEMPLATE);

    const denoJson = JSON.parse(await Deno.readTextFile(join(dir, "deno.json")));
    assertStringIncludes(denoJson.tasks.dev, "main.ts");
    assertStringIncludes(denoJson.tasks.build, "main.ts");
    assertStringIncludes(denoJson.tasks.serve, "main.ts");
    // Site's own imports survive the merge
    assertEquals(denoJson.imports.preact, "npm:preact@^10");
    assertEquals(denoJson.imports["@dune/core"], "jsr:@dune/core@^0.29");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("migrate:entrypoint: adds missing dune-core runtime imports", async () => {
  const dir = await makeLegacySite();
  try {
    const result = await migrateEntrypointCommand(dir);
    assertEquals(result.addedImports.includes("@std/path"), true);
    assertEquals(result.addedImports.includes("polizy"), true);

    const denoJson = JSON.parse(await Deno.readTextFile(join(dir, "deno.json")));
    assertEquals(typeof denoJson.imports["@std/path"], "string");
    assertEquals(typeof denoJson.imports["polizy"], "string");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("migrate:entrypoint: doesn't clobber an import the site already declares", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(dir, "deno.json"),
      JSON.stringify({
        imports: {
          "@dune/core": "jsr:@dune/core@^0.29",
          "@std/path": "jsr:@std/path@^999", // deliberately different from the template's pin
        },
        tasks: { dev: "dune dev", build: "dune build", serve: "dune serve" },
      }),
    );
    const result = await migrateEntrypointCommand(dir);
    assertEquals(result.addedImports.includes("@std/path"), false);
    const denoJson = JSON.parse(await Deno.readTextFile(join(dir, "deno.json")));
    assertEquals(denoJson.imports["@std/path"], "jsr:@std/path@^999");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("migrate:entrypoint: idempotent — re-running an already-migrated site is a no-op", async () => {
  const dir = await makeLegacySite();
  try {
    await migrateEntrypointCommand(dir);
    const denoJsonAfterFirst = await Deno.readTextFile(join(dir, "deno.json"));

    const result = await migrateEntrypointCommand(dir);
    assertEquals(result.alreadyMigrated, true);
    assertEquals(result.migrated, false);

    const denoJsonAfterSecond = await Deno.readTextFile(join(dir, "deno.json"));
    assertEquals(denoJsonAfterFirst, denoJsonAfterSecond);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("migrate:entrypoint: refuses to overwrite a hand-edited main.ts", async () => {
  const dir = await makeLegacySite();
  try {
    await Deno.writeTextFile(join(dir, "main.ts"), "// a customized entrypoint\nconsole.log('hi');\n");
    const result = await migrateEntrypointCommand(dir);
    assertEquals(result.migrated, false);
    assertEquals(typeof result.refusedReason, "string");

    // Neither main.ts nor tasks were touched
    const mainTs = await Deno.readTextFile(join(dir, "main.ts"));
    assertStringIncludes(mainTs, "a customized entrypoint");
    const denoJson = JSON.parse(await Deno.readTextFile(join(dir, "deno.json")));
    assertEquals(denoJson.tasks.dev, "dune dev");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("migrate:entrypoint: --dry-run touches nothing", async () => {
  const dir = await makeLegacySite();
  try {
    const result = await migrateEntrypointCommand(dir, { dryRun: true });
    assertEquals(result.migrated, false);

    const mainTsExists = await Deno.stat(join(dir, "main.ts")).then(() => true).catch(() => false);
    assertEquals(mainTsExists, false);

    const denoJson = JSON.parse(await Deno.readTextFile(join(dir, "deno.json")));
    assertEquals(denoJson.tasks.dev, "dune dev");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("migrate:entrypoint: rewrites .mcp.json when present", async () => {
  const dir = await makeLegacySite();
  try {
    await Deno.writeTextFile(
      join(dir, ".mcp.json"),
      JSON.stringify({
        mcpServers: { dune: { command: "deno", args: ["run", "-A", "jsr:@dune/core/cli", "mcp:serve"], cwd: "." } },
      }),
    );
    const result = await migrateEntrypointCommand(dir);
    assertEquals(result.rewroteMcpJson, true);
    const mcpJson = JSON.parse(await Deno.readTextFile(join(dir, ".mcp.json")));
    assertEquals(mcpJson.mcpServers.dune.args.some((a: string) => a.includes("main.ts")), true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
