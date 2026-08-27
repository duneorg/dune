/**
 * Tests for dev-link.ts's checkout-root resolution — the piece
 * import-map-error.ts's stale-shim disambiguation also depends on.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildInstallArgs, resolveCheckoutRoot } from "../../src/cli/dev-link.ts";

Deno.test("resolveCheckoutRoot: resolves to this checkout's actual root", async () => {
  const root = resolveCheckoutRoot();
  // The root should contain this checkout's own deno.json declaring
  // "@dune/core" — the same identity check local-checkout-detect.ts uses.
  const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
  assertEquals(config.name, "@dune/core");
});

Deno.test("resolveCheckoutRoot: src/cli.ts exists at the resolved root", async () => {
  const root = resolveCheckoutRoot();
  const stat = await Deno.stat(`${root}/src/cli.ts`);
  assertEquals(stat.isFile, true);
});

Deno.test("buildInstallArgs: uses --config, not --import-map (regression guard — see module doc)", () => {
  const args = buildInstallArgs("/some/checkout");
  assertEquals(args.includes("--config=/some/checkout/deno.json"), true);
  assertEquals(args.some((a) => a.startsWith("--import-map")), false);
});

Deno.test("buildInstallArgs: forces the install and names the shim 'dune'", () => {
  const args = buildInstallArgs("/some/checkout");
  assertEquals(args.includes("--force"), true);
  const nameIdx = args.indexOf("-n");
  assertEquals(args[nameIdx + 1], "dune");
});

Deno.test("buildInstallArgs: entrypoint is this checkout's own src/cli.ts", () => {
  const args = buildInstallArgs("/some/checkout");
  assertEquals(args.at(-1), "/some/checkout/src/cli.ts");
});
