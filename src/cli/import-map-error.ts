/**
 * Utilities for detecting and formatting Deno import-map resolution errors.
 *
 * Deno requires every npm package sub-path (e.g. `y-protocols/awareness`) to
 * have an explicit entry in the import map.  When one is missing the runtime
 * throws a module-graph error before any user code runs, which is hard to act
 * on.  These helpers intercept that error and rewrite it into an actionable
 * message pointing at the exact missing entry.
 */

// Covers both forms Deno uses:
//   "Import "x" not a dependency and not in import map"
//   "Import "x" not in import map"
const IMPORT_MAP_RE =
  /Import "([^"]+)" not (?:a dependency and )?not in import map/;

export function isImportMapError(err: unknown): err is Error {
  return err instanceof Error && IMPORT_MAP_RE.test(err.message);
}

/**
 * Return a formatted, actionable error string for a missing import map entry.
 *
 * @example
 * // "[dune] Missing import map entry: "y-protocols/awareness" …"
 */
export function formatImportMapError(err: Error): string {
  const match = err.message.match(IMPORT_MAP_RE);
  const specifier = match?.[1] ?? "unknown";

  return (
    `[dune] Missing import map entry: "${specifier}"\n\n` +
    `A Dune module requires this specifier but it isn't declared in deno.json.\n` +
    `Add it under "imports":\n\n` +
    `  "${specifier}": "npm:${specifier}"\n\n` +
    `Or run:  deno add npm:${specifier}`
  );
}
