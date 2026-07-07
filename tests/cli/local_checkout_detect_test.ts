/**
 * Tests for local-checkout-detect.ts — the "unused workspace checkout"
 * warning that fires when `dune dev`/`dune serve` is about to lock into
 * running the published @dune/core package while a local workspace
 * checkout sits on disk unused (see module doc for why this happens).
 */

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { join } from "@std/path";
import { findLocalDuneCoreCheckout, warnIfLocalCheckoutUnused } from "../../src/cli/local-checkout-detect.ts";

async function makeWorkspace(): Promise<{ root: string; corePath: string; siteDir: string }> {
  const root = await Deno.makeTempDir();
  const corePath = join(root, "dune");
  const siteDir = join(root, "demos", "some-site");
  await Deno.mkdir(corePath, { recursive: true });
  await Deno.mkdir(siteDir, { recursive: true });

  await Deno.writeTextFile(
    join(root, "deno.json"),
    JSON.stringify({ workspace: ["./dune"] }),
  );
  await Deno.writeTextFile(
    join(corePath, "deno.json"),
    JSON.stringify({ name: "@dune/core", version: "0.0.0-test" }),
  );
  return { root, corePath, siteDir };
}

Deno.test("findLocalDuneCoreCheckout: finds @dune/core from a nested site dir", async () => {
  const { corePath, siteDir } = await makeWorkspace();
  const found = await findLocalDuneCoreCheckout(siteDir);
  assertEquals(found, await Deno.realPath(corePath));
});

Deno.test("findLocalDuneCoreCheckout: finds it from deep nesting under the site dir", async () => {
  const { corePath, siteDir } = await makeWorkspace();
  const deepDir = join(siteDir, "content", "nested", "deeply");
  await Deno.mkdir(deepDir, { recursive: true });
  const found = await findLocalDuneCoreCheckout(deepDir);
  assertEquals(found, await Deno.realPath(corePath));
});

Deno.test("findLocalDuneCoreCheckout: returns null when no workspace is found", async () => {
  const dir = await Deno.makeTempDir();
  assertEquals(await findLocalDuneCoreCheckout(dir), null);
});

Deno.test("findLocalDuneCoreCheckout: returns null when workspace exists but has no @dune/core member", async () => {
  const root = await Deno.makeTempDir();
  const otherPkg = join(root, "other-pkg");
  await Deno.mkdir(otherPkg, { recursive: true });
  await Deno.writeTextFile(join(root, "deno.json"), JSON.stringify({ workspace: ["./other-pkg"] }));
  await Deno.writeTextFile(join(otherPkg, "deno.json"), JSON.stringify({ name: "@example/other" }));

  assertEquals(await findLocalDuneCoreCheckout(root), null);
});

Deno.test("warnIfLocalCheckoutUnused: prints a warning naming the local path when found", async () => {
  const { corePath, siteDir } = await makeWorkspace();

  const originalError = console.error;
  const lines: string[] = [];
  console.error = (...args: unknown[]) => lines.push(args.join(" "));
  try {
    await warnIfLocalCheckoutUnused(siteDir);
  } finally {
    console.error = originalError;
  }

  assertEquals(lines.length, 1);
  assertStringIncludes(lines[0], await Deno.realPath(corePath));
  assertStringIncludes(lines[0], "--config");
});

Deno.test("warnIfLocalCheckoutUnused: stays silent when no local checkout is found", async () => {
  const dir = await Deno.makeTempDir();

  const originalError = console.error;
  const lines: string[] = [];
  console.error = (...args: unknown[]) => lines.push(args.join(" "));
  try {
    await warnIfLocalCheckoutUnused(dir);
  } finally {
    console.error = originalError;
  }

  assertEquals(lines.length, 0);
});
