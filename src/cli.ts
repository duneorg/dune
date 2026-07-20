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
 *    If the site root (--root, default ".") has its own deno.json, the two
 *    configs are merged (site imports win) into a temporary config and the
 *    re-exec uses that instead.  This matters when dune's deno.json is a
 *    workspace member: its import map only applies to files inside the
 *    workspace, so site theme TSX outside it would otherwise fail with
 *    "not in import map" errors on bare specifiers like preact.
 *
 * 2. Remote (JSR/https) — handled by cli-impl.ts, which re-execs with the
 *    site's deno.json so site-specific imports (preact version, theme
 *    components) are in scope.
 *
 * Set DUNE_CONFIG_APPLIED=1 to skip the re-exec entirely and run with
 * whatever config the invoking process supplied.
 *
 * The re-exec'd child is the canonical process: Deno-level flags on the
 * OUTER invocation do not survive into it (Deno gives a script no way to
 * introspect its own CLI flags), so anything that must hold for the child —
 * notably lockfile enforcement — is expressed at the dune level (CLI arg or
 * env var) and rendered into the child's args; see cli/lock-policy.ts for
 * the lockfile decision table. Known, accepted non-carryovers: the child
 * always runs --allow-all regardless of the outer permission set (dune
 * requires -A), and an outer --watch does not propagate (`dune dev` has its
 * own watcher).
 *
 * Because all real imports are deferred to cli-impl.ts via a dynamic import,
 * any "not in import map" error that slips through is caught here and
 * rewritten into an actionable message.
 *
 * This module also re-exports the callable `cli()` entry (see cli-impl.ts)
 * for sites that generate a `main.ts` importing `@dune/core/cli` directly —
 * that's a plain function call with no re-exec involved, so everything above
 * is gated behind `import.meta.main`: merely importing this module (rather
 * than running it as the invoked script) must not trigger any of it.
 *
 * @module
 */

import {
  formatImportMapError,
  isImportMapError,
} from "./cli/import-map-error.ts";
import { waitForwardingSignals } from "./cli/forward-signals.ts";
import { buildMergedConfig } from "./cli/merge-config.ts";
import { loadEnvFile, parseEnvFileArg } from "./cli/env-file.ts";
import {
  computeLockPolicy,
  lockPolicyToArgs,
  parseRootArg,
  preflightLockPolicy,
} from "./cli/lock-policy.ts";

// ── 0. Optional --env-file loading ─────────────────────────────────────────────
//
// Must run before either re-exec below: both spread `Deno.env.toObject()`
// into the child's env, so anything loaded here propagates through every
// re-exec layer (local-source and remote/JSR) for free.

if (import.meta.main) {
  const envFileArg = parseEnvFileArg(Deno.args);
  if (envFileArg) {
    try {
      await loadEnvFile(envFileArg, parseRootArg(Deno.args));
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      Deno.exit(1);
    }
  }
}

// ── 1. Local source re-exec ────────────────────────────────────────────────────

/**
 * Decide which --config to re-exec with. Returns dune's own deno.json path,
 * or — when the site root has a separate deno.json — the path of a temporary
 * merged config (dune imports + site imports, site wins). Returns the temp
 * dir for cleanup in the latter case.
 */
async function resolveConfig(
  duneConfigPath: string,
): Promise<{ configPath: string; tempDir?: string }> {
  let siteConfigPath: string;
  try {
    const siteRoot = await Deno.realPath(parseRootArg(Deno.args));
    siteConfigPath = `${siteRoot}/deno.json`;
    await Deno.stat(siteConfigPath);
    if (siteConfigPath === await Deno.realPath(duneConfigPath)) {
      return { configPath: duneConfigPath }; // running inside the dune repo itself
    }
  } catch {
    return { configPath: duneConfigPath }; // no site root / no site deno.json
  }
  try {
    const merged = await buildMergedConfig(duneConfigPath, siteConfigPath);
    const tempDir = await Deno.makeTempDir({ prefix: "dune-config-" });
    const configPath = `${tempDir}/deno.json`;
    await Deno.writeTextFile(configPath, JSON.stringify(merged, null, 2));
    return { configPath, tempDir };
  } catch {
    // Unreadable/non-JSON site config — fall back to dune's own
    return { configPath: duneConfigPath };
  }
}

if (
  import.meta.main && import.meta.url.startsWith("file://") &&
  !Deno.env.get("DUNE_CONFIG_APPLIED")
) {
  try {
    const duneConfigPath = new URL("../deno.json", import.meta.url).pathname;
    await Deno.stat(duneConfigPath); // verify it exists before re-execing
    const { configPath, tempDir } = await resolveConfig(duneConfigPath);
    const lockPolicy = await computeLockPolicy(Deno.args);
    const lockError = await preflightLockPolicy(lockPolicy);
    if (lockError) {
      console.error(lockError);
      if (tempDir) {
        await Deno.remove(tempDir, { recursive: true }).catch(() => {});
      }
      Deno.exit(1);
    }
    const cmd = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--allow-all",
        `--config=${configPath}`,
        ...lockPolicyToArgs(lockPolicy),
        import.meta.url,
        ...Deno.args,
      ],
      env: {
        ...Deno.env.toObject(),
        DUNE_CONFIG_APPLIED: "1",
        DENO_NO_UPDATE_CHECK: "1",
      },
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    const status = await waitForwardingSignals(cmd.spawn());
    if (tempDir) {
      await Deno.remove(tempDir, { recursive: true }).catch(() => {});
    }
    Deno.exit(status.code);
  } catch {
    // deno.json not found next to source — fall through and try to run as-is
  }
}

// ── 2. Load real CLI ───────────────────────────────────────────────────────────

if (import.meta.main) {
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
}

// ── 3. Callable export for generated site entrypoints ─────────────────────────

export { cli } from "./cli-impl.ts";
