/**
 * Tests for workspace-member-check.ts — the "unregistered workspace member"
 * warning that fires when `dune new` scaffolds a site inside an enclosing
 * Deno workspace that doesn't list it, which otherwise fails silently at
 * `deno task dev` with "Config file must be a member of the workspace"
 * (duneorg/dune#6).
 */

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { join } from "@std/path";
import { warnIfUnregisteredWorkspaceMember } from "../../src/cli/workspace-member-check.ts";

async function captureWarnings(fn: () => Promise<void>): Promise<string[]> {
  const original = console.warn;
  const lines: string[] = [];
  console.warn = (...args: unknown[]) => lines.push(args.join(" "));
  try {
    await fn();
  } finally {
    console.warn = original;
  }
  return lines;
}

Deno.test("warnIfUnregisteredWorkspaceMember: warns and names the exact member line to add", async () => {
  const root = await Deno.makeTempDir();
  const siteDir = join(root, "demos", "my-site");
  await Deno.mkdir(siteDir, { recursive: true });
  await Deno.writeTextFile(join(root, "deno.json"), JSON.stringify({ workspace: ["./dune"] }));
  await Deno.writeTextFile(join(siteDir, "deno.json"), JSON.stringify({}));

  const lines = await captureWarnings(() => warnIfUnregisteredWorkspaceMember(siteDir));

  assertEquals(lines.length, 1);
  assertStringIncludes(lines[0], "Config file must be a member of the workspace");
  assertStringIncludes(lines[0], `"./demos/my-site"`);
  assertStringIncludes(lines[0], await Deno.realPath(root));
});

Deno.test("warnIfUnregisteredWorkspaceMember: stays silent when the site is already a listed member", async () => {
  const root = await Deno.makeTempDir();
  const siteDir = join(root, "my-site");
  await Deno.mkdir(siteDir, { recursive: true });
  await Deno.writeTextFile(
    join(root, "deno.json"),
    JSON.stringify({ workspace: ["./dune", "./my-site"] }),
  );
  await Deno.writeTextFile(join(siteDir, "deno.json"), JSON.stringify({}));

  const lines = await captureWarnings(() => warnIfUnregisteredWorkspaceMember(siteDir));

  assertEquals(lines.length, 0);
});

Deno.test("warnIfUnregisteredWorkspaceMember: stays silent when there is no enclosing workspace", async () => {
  const root = await Deno.makeTempDir();
  const siteDir = join(root, "my-site");
  await Deno.mkdir(siteDir, { recursive: true });
  await Deno.writeTextFile(join(siteDir, "deno.json"), JSON.stringify({}));

  const lines = await captureWarnings(() => warnIfUnregisteredWorkspaceMember(siteDir));

  assertEquals(lines.length, 0);
});
