/**
 * dune dev:link — reinstall the global `dune` shim against this checkout.
 *
 * The README previously documented `deno install --global -n dune -A
 * --import-map=deno.json src/cli.ts` for local development. Two distinct
 * problems, both duneorg/dune#6:
 *
 * 1. `--import-map` treats `deno.json`'s `imports` as a literal, spec-plain
 *    import map with no JSR/npm package-export-map awareness — every
 *    subpath actually used (`@std/encoding/base64url`,
 *    `@dune/core/ui/editable`, ...) needs its own exact entry, even though
 *    normal `--config`-based resolution (what `dune dev`/`deno check` use)
 *    happily resolves the same subpaths through just the bare package
 *    entry. Confirmed directly: the same file that type-checks cleanly with
 *    `--config` fails to install with `--import-map` on an untouched
 *    subpath. `--config` does not have this problem and produces the same
 *    kind of shim, so this uses `--config` instead.
 * 2. Whichever flag is used, `deno install` copies `deno.json` into a
 *    frozen snapshot at install time (`~/.deno/bin/.dune/deno.json`) rather
 *    than reading it live. The shim's entrypoint keeps pointing at this
 *    checkout's `src/cli.ts` — so code changes are picked up immediately —
 *    but the snapshot does not, and silently goes stale the moment
 *    `deno.json`'s `imports` change afterward, failing with a confusing
 *    `Import "X" not a dependency and not in import map` error unrelated to
 *    whatever was actually just changed.
 *
 * This wraps the (corrected) install command so nobody has to remember or
 * retype it. The checkout root is resolved from this module's own
 * location, which works correctly even when invoked through an
 * already-stale shim: only the frozen snapshot goes stale, never the
 * entrypoint itself.
 *
 * @module
 */

import { dirname, fromFileUrl, join } from "@std/path";

/** Absolute path to this checkout's root (three levels up from this file). */
export function resolveCheckoutRoot(): string {
  const thisFile = fromFileUrl(import.meta.url);
  return dirname(dirname(dirname(thisFile)));
}

/**
 * Build the `deno install` argument list for relinking. Pure and exported
 * for testing — the `--config` (not `--import-map`) flag is the entire
 * point of this command, see the module doc, and worth pinning down so it
 * can't silently regress back to the flag that doesn't resolve subpaths.
 */
export function buildInstallArgs(checkoutRoot: string): string[] {
  const cliEntry = join(checkoutRoot, "src", "cli.ts");
  const configPath = join(checkoutRoot, "deno.json");
  return [
    "install",
    "--global",
    "--force",
    "-n",
    "dune",
    "-A",
    `--config=${configPath}`,
    cliEntry,
  ];
}

export async function devLinkCommand(): Promise<void> {
  const checkoutRoot = resolveCheckoutRoot();
  const configPath = join(checkoutRoot, "deno.json");

  console.log(`🏜️  Dune — relinking the global "dune" shim to this checkout...\n`);
  console.log(`  Checkout: ${checkoutRoot}`);
  console.log(`  Config:   ${configPath}\n`);

  const cmd = new Deno.Command(Deno.execPath(), {
    args: buildInstallArgs(checkoutRoot),
    stdout: "inherit",
    stderr: "inherit",
  });
  const { success, code } = await cmd.output();

  if (!success) {
    console.error(`\n  ✗ Relink failed (exit ${code})`);
    Deno.exit(code);
  }

  console.log(
    `\n  ✅ Global "dune" shim now points at this checkout, with a fresh import map.`,
  );
}
