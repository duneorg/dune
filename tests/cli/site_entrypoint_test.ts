import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { planSiteEntrypoint } from "../../src/cli/site-entrypoint.ts";
import { MAIN_TS_TEMPLATE } from "../../src/cli/entrypoint-template.ts";

const noEnv = { get: (_: string) => undefined };

async function makeSite(
  opts: { mainTs?: string | null; tasks?: Record<string, unknown> } = {},
): Promise<string> {
  const dir = await Deno.realPath(await Deno.makeTempDir());
  if (opts.mainTs !== null) {
    await Deno.writeTextFile(join(dir, "main.ts"), opts.mainTs ?? MAIN_TS_TEMPLATE);
  }
  await Deno.writeTextFile(
    join(dir, "deno.json"),
    JSON.stringify({ tasks: opts.tasks ?? {} }),
  );
  return dir;
}

Deno.test("planSiteEntrypoint: a site task that runs main.ts is used, with the user's extra args appended", async () => {
  const dir = await makeSite({
    tasks: { dev: "deno run -A --watch=main.ts main.ts dev --env-file" },
  });
  try {
    const plan = await planSiteEntrypoint(["dev", "--root", dir, "--port", "3001"], noEnv);
    assertEquals(plan?.denoArgs, ["task", "dev", "--port", "3001"]);
    assertEquals(plan?.cwd, dir);
    assertEquals(plan?.description, "deno task dev");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("planSiteEntrypoint: object-form tasks are understood", async () => {
  const dir = await makeSite({
    tasks: { serve: { command: "deno run -A main.ts serve --env-file" } },
  });
  try {
    const plan = await planSiteEntrypoint(["serve", `--root=${dir}`], noEnv);
    assertEquals(plan?.denoArgs, ["task", "serve"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("planSiteEntrypoint: no matching task falls back to running main.ts directly", async () => {
  const dir = await makeSite({ tasks: { lint: "deno lint" } });
  try {
    const plan = await planSiteEntrypoint(["validate", "--root", dir, "--json"], noEnv);
    assertEquals(plan?.denoArgs, ["run", "-A", "main.ts", "validate", "--json"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("planSiteEntrypoint: a task that calls `dune` itself is not used (no loop)", async () => {
  const dir = await makeSite({ tasks: { dev: "dune dev" } });
  try {
    const plan = await planSiteEntrypoint(["dev", "--root", dir], noEnv);
    assertEquals(plan?.denoArgs, ["run", "-A", "main.ts", "dev"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("planSiteEntrypoint: no main.ts, or an edited one, means normal CLI", async () => {
  const none = await makeSite({ mainTs: null });
  const edited = await makeSite({ mainTs: MAIN_TS_TEMPLATE + "// custom\n" });
  try {
    assertEquals(await planSiteEntrypoint(["dev", "--root", none], noEnv), null);
    assertEquals(await planSiteEntrypoint(["dev", "--root", edited], noEnv), null);
  } finally {
    await Deno.remove(none, { recursive: true });
    await Deno.remove(edited, { recursive: true });
  }
});

Deno.test("planSiteEntrypoint: machine/install commands and flags are never deferred", async () => {
  const dir = await makeSite();
  try {
    for (
      const cmd of [
        "new",
        "ps",
        "stop",
        "dev:link",
        "upgrade",
        "lockfile:sync",
        "migrate:entrypoint",
        "--help",
        "--version",
      ]
    ) {
      assertEquals(await planSiteEntrypoint([cmd, "--root", dir], noEnv), null, cmd);
    }
    assertEquals(await planSiteEntrypoint([], noEnv), null);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("planSiteEntrypoint: DUNE_SITE_ENTRYPOINT=off and the loop guard opt out", async () => {
  const dir = await makeSite();
  try {
    const off = { get: (k: string) => (k === "DUNE_SITE_ENTRYPOINT" ? "off" : undefined) };
    const guarded = { get: (k: string) => (k === "DUNE_VIA_SITE_ENTRYPOINT" ? "1" : undefined) };
    assertEquals(await planSiteEntrypoint(["dev", "--root", dir], off), null);
    assertEquals(await planSiteEntrypoint(["dev", "--root", dir], guarded), null);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
