/**
 * Utilities for detecting and formatting Deno import-map resolution errors.
 *
 * A missing `deno.json` import-map entry throws a module-graph error before
 * any user code runs, which is hard to act on. These helpers intercept that
 * error and rewrite it into an actionable message pointing at the exact
 * missing entry.
 *
 * One specific cause gets a different, more useful message: a maintainer's
 * globally-installed local-dev `dune` shim (`deno install --global
 * --import-map=deno.json src/cli.ts`, see README) freezes a *snapshot* of
 * `deno.json` at install time rather than reading it live — so it silently
 * goes stale the moment `deno.json`'s `imports` change afterward, and fails
 * with exactly this error even though the checkout's own `deno.json` already
 * has the entry (duneorg/dune#6). {@link formatImportMapError} checks for
 * that specific situation and points at `dune dev:link` instead of telling
 * someone to add an entry that's already there.
 */

import { join } from "@std/path";
import { resolveCheckoutRoot } from "./dev-link.ts";

// Covers both forms Deno uses:
//   "Import "x" not a dependency and not in import map"
//   "Import "x" not in import map"
// The second "not" only appears in the long form, so it has to live inside
// the optional group too — a bare `not (?:a dependency and )?not in import
// map` (the previous version of this regex) required "not" twice
// unconditionally and never actually matched the short form despite this
// comment always having claimed it did.
const IMPORT_MAP_RE =
  /Import "([^"]+)" not (?:a dependency and not )?in import map/;

export function isImportMapError(err: unknown): err is Error {
  return err instanceof Error && IMPORT_MAP_RE.test(err.message);
}

/** `@scope/pkg/sub/path` -> `@scope/pkg`; `pkg/sub/path` -> `pkg`. */
function topLevelPackageName(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

/**
 * True when `specifier`'s top-level package already has an entry in this
 * checkout's own (live, on-disk) `deno.json` — the signature of a stale
 * global-shim import-map snapshot rather than a genuinely missing import.
 * Resilient by design: any failure to read/parse just means "no", so a
 * broken lookup falls back to the generic missing-entry message.
 */
async function isLikelyStaleShim(specifier: string): Promise<boolean> {
  try {
    const checkoutRoot = resolveCheckoutRoot();
    const denoJsonPath = join(checkoutRoot, "deno.json");
    const config = JSON.parse(await Deno.readTextFile(denoJsonPath));
    const imports = config?.imports;
    if (!imports || typeof imports !== "object") return false;
    return topLevelPackageName(specifier) in imports;
  } catch {
    return false;
  }
}

/**
 * Return a formatted, actionable error string for a missing import map entry.
 *
 * @example
 * // "[dune] Missing import map entry: "y-protocols/awareness" …"
 */
export async function formatImportMapError(err: Error): Promise<string> {
  const match = err.message.match(IMPORT_MAP_RE);
  const specifier = match?.[1] ?? "unknown";

  if (specifier !== "unknown" && (await isLikelyStaleShim(specifier))) {
    return (
      `[dune] Missing import map entry: "${specifier}"\n\n` +
      `This checkout's own deno.json already declares this import — the ` +
      `globally-installed "dune" shim's import map is just out of date.\n\n` +
      `Run:  dune dev:link`
    );
  }

  return (
    `[dune] Missing import map entry: "${specifier}"\n\n` +
    `A Dune module requires this specifier but it isn't declared in deno.json.\n` +
    `Add it under "imports":\n\n` +
    `  "${specifier}": "npm:${specifier}"\n\n` +
    `Or run:  deno add npm:${specifier}`
  );
}
