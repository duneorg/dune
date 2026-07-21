/**
 * Tests for merge-config.ts — dune's own deno.json merged with a site's
 * (site wins) for the local-source and lockfile-discovery re-exec paths.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  absolutizeImports,
  buildMergedConfig,
} from "../../src/cli/merge-config.ts";

Deno.test("absolutizeImports: rewrites relative paths to absolute file:// URLs", () => {
  const configUrl = new URL("file:///site/deno.json");
  const result = absolutizeImports(
    { "@dune/core": "../dune/src/mod.ts", "preact": "npm:preact@^10" },
    configUrl,
  );
  assertEquals(result["@dune/core"], "file:///dune/src/mod.ts");
  assertEquals(result["preact"], "npm:preact@^10");
});

async function withTempConfigs(
  dune: Record<string, unknown>,
  site: Record<string, unknown>,
  run: (dunePath: string, sitePath: string) => Promise<void>,
): Promise<void> {
  const dir = await Deno.makeTempDir();
  try {
    const dunePath = `${dir}/dune-deno.json`;
    const sitePath = `${dir}/site-deno.json`;
    await Deno.writeTextFile(dunePath, JSON.stringify(dune));
    await Deno.writeTextFile(sitePath, JSON.stringify(site));
    await run(dunePath, sitePath);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("buildMergedConfig: site imports win over dune's on key collision", async () => {
  await withTempConfigs(
    { imports: { "shared": "npm:shared@^1" } },
    { imports: { "shared": "npm:shared@^2" } },
    async (dunePath, sitePath) => {
      const merged = await buildMergedConfig(dunePath, sitePath);
      assertEquals(
        (merged.imports as Record<string, string>)["shared"],
        "npm:shared@^2",
      );
    },
  );
});

Deno.test("buildMergedConfig: minimumDependencyAge from site is preserved, not dropped", async () => {
  await withTempConfigs(
    {},
    { minimumDependencyAge: { age: "P1D", exclude: ["jsr:@dune/plugin-pdf"] } },
    async (dunePath, sitePath) => {
      const merged = await buildMergedConfig(dunePath, sitePath);
      assertEquals(merged.minimumDependencyAge, {
        age: "P1D",
        exclude: ["jsr:@dune/plugin-pdf"],
      });
    },
  );
});

Deno.test("buildMergedConfig: site's minimumDependencyAge wins over dune's own", async () => {
  await withTempConfigs(
    { minimumDependencyAge: { age: "P7D", exclude: [] } },
    { minimumDependencyAge: { age: "P1D", exclude: ["jsr:@dune/core"] } },
    async (dunePath, sitePath) => {
      const merged = await buildMergedConfig(dunePath, sitePath);
      assertEquals(merged.minimumDependencyAge, {
        age: "P1D",
        exclude: ["jsr:@dune/core"],
      });
    },
  );
});

Deno.test("buildMergedConfig: falls back to dune's minimumDependencyAge when site has none", async () => {
  await withTempConfigs(
    { minimumDependencyAge: { age: "P1D", exclude: [] } },
    {},
    async (dunePath, sitePath) => {
      const merged = await buildMergedConfig(dunePath, sitePath);
      assertEquals(merged.minimumDependencyAge, { age: "P1D", exclude: [] });
    },
  );
});

Deno.test("buildMergedConfig: omits minimumDependencyAge entirely when neither side sets it", async () => {
  await withTempConfigs(
    {},
    {},
    async (dunePath, sitePath) => {
      const merged = await buildMergedConfig(dunePath, sitePath);
      assertEquals("minimumDependencyAge" in merged, false);
    },
  );
});

Deno.test("buildMergedConfig: unstable arrays are unioned and deduped", async () => {
  await withTempConfigs(
    { unstable: ["kv", "cron"] },
    { unstable: ["cron", "temporal"] },
    async (dunePath, sitePath) => {
      const merged = await buildMergedConfig(dunePath, sitePath);
      assertEquals(
        new Set(merged.unstable as string[]),
        new Set(["kv", "cron", "temporal"]),
      );
    },
  );
});

Deno.test("buildMergedConfig: nodeModulesDir — site wins when both set", async () => {
  await withTempConfigs(
    { nodeModulesDir: "manual" },
    { nodeModulesDir: "auto" },
    async (dunePath, sitePath) => {
      const merged = await buildMergedConfig(dunePath, sitePath);
      assertEquals(merged.nodeModulesDir, "auto");
    },
  );
});
