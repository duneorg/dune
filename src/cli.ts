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
 * @module
 */

import { isImportMapError, formatImportMapError } from "./cli/import-map-error.ts";
import { waitForwardingSignals } from "./cli/forward-signals.ts";
import {
  computeLockPolicy,
  lockPolicyToArgs,
  parseRootArg,
  preflightLockPolicy,
} from "./cli/lock-policy.ts";

// ── 1. Local source re-exec ────────────────────────────────────────────────────

/** Rewrite relative import-map values to absolute file:// URLs so the map
 * stays valid when written to a config file in a different directory. */
function absolutizeImports(
  imports: Record<string, string>,
  configUrl: URL,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(imports)) {
    out[key] = value.startsWith("./") || value.startsWith("../")
      ? new URL(value, configUrl).href
      : value;
  }
  return out;
}

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
    const dune = JSON.parse(await Deno.readTextFile(duneConfigPath));
    const site = JSON.parse(await Deno.readTextFile(siteConfigPath));
    const duneUrl = new URL(`file://${duneConfigPath}`);
    const siteUrl = new URL(`file://${siteConfigPath}`);
    const merged = {
      imports: {
        ...absolutizeImports(dune.imports ?? {}, duneUrl),
        ...absolutizeImports(site.imports ?? {}, siteUrl),
      },
      scopes: { ...dune.scopes, ...site.scopes },
      compilerOptions: { ...dune.compilerOptions, ...site.compilerOptions },
      unstable: [...new Set([...(dune.unstable ?? []), ...(site.unstable ?? [])])],
      ...(site.nodeModulesDir ?? dune.nodeModulesDir
        ? { nodeModulesDir: site.nodeModulesDir ?? dune.nodeModulesDir }
        : {}),
    };
    const tempDir = await Deno.makeTempDir({ prefix: "dune-config-" });
    const configPath = `${tempDir}/deno.json`;
    await Deno.writeTextFile(configPath, JSON.stringify(merged, null, 2));
    return { configPath, tempDir };
  } catch {
    // Unreadable/non-JSON site config — fall back to dune's own
    return { configPath: duneConfigPath };
  }
}

if (import.meta.url.startsWith("file://") && !Deno.env.get("DUNE_CONFIG_APPLIED")) {
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
      env: { ...Deno.env.toObject(), DUNE_CONFIG_APPLIED: "1", DENO_NO_UPDATE_CHECK: "1" },
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
