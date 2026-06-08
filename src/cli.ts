/**
 * Dune CLI — thin entry-point shim.
 *
 * This file has zero external dependencies so it always loads cleanly,
 * regardless of which import map is active.
 *
 * Two re-exec strategies keep the import map correct in all cases:
 *
 * 1. Local source (file:// URL) — re-exec with the live deno.json next to
 *    the source tree.  This means `deno install` snapshots are never stale:
 *    whatever config was frozen at install time, the shim discards it and
 *    uses the current deno.json on every invocation.
 *
 * 2. Remote (JSR/https) — handled by cli-impl.ts, which re-execs with the
 *    site's deno.json so site-specific imports (preact version, theme
 *    components) are in scope.
 *
 * Because all real imports are deferred to cli-impl.ts via a dynamic import,
 * any "not in import map" error that slips through is caught here and
 * rewritten into an actionable message.
 */

import { isImportMapError, formatImportMapError } from "./cli/import-map-error.ts";

// ── 1. Local source re-exec ────────────────────────────────────────────────────

if (import.meta.url.startsWith("file://") && !Deno.env.get("DUNE_CONFIG_APPLIED")) {
  try {
    const denoJsonPath = new URL("../deno.json", import.meta.url).pathname;
    await Deno.stat(denoJsonPath); // verify it exists before re-execing
    const cmd = new Deno.Command(Deno.execPath(), {
      args: ["run", "--allow-all", `--config=${denoJsonPath}`, import.meta.url, ...Deno.args],
      env: { ...Deno.env.toObject(), DUNE_CONFIG_APPLIED: "1" },
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    const status = await cmd.spawn().status;
    Deno.exit(status.code);
  } catch {
    // deno.json not found next to source — fall through and try to run as-is
  }
}

// ── 2. Load real CLI ───────────────────────────────────────────────────────────

try {
  const { main } = await import("./cli-impl.ts");
  await main();
} catch (err) {
  if (isImportMapError(err)) {
    console.error(formatImportMapError(err as Error));
    Deno.exit(1);
  }
  throw err;
}
