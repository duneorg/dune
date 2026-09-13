/**
 * `dune doctor` — environment/runtime health checks for a site.
 *
 * `dune validate` covers project *correctness*: config shape, plugin
 * pinning, template references, content integrity — all in-process, no
 * subprocesses, no real boot. This command covers what `validate`
 * structurally can't see: can this site's dependency graph actually
 * resolve and boot, on this machine, right now. It deliberately does not
 * duplicate `validate`'s checks; run both for full coverage.
 *
 * Motivated by duneorg/dune#2 (`dune dev` failing on a freshly scaffolded
 * site because of local npm-cache corruption) and duneorg/dune#26 — real
 * prevention isn't achievable (it isn't Dune's cache to fix), but shrinking
 * the gap between "something's wrong" and "here's the fix" is: the default
 * run resolves the site's dependency graph proactively (catching the same
 * class of failure before `dev`/`serve` ever hits it) and reformats the
 * npm-cache-mismatch error shape into the actionable steps from
 * `npm-cache-error.ts` instead of a raw stack trace.
 *
 * Default run is fast — no subprocess spawns a long-lived server. `--boot`
 * additionally spawns the site for real and makes a request against it;
 * opted out of by default since it's the slowest and most failure-prone
 * step (port binding, timeouts).
 *
 * `dune new` runs the fast checks automatically after scaffolding;
 * `dune new --verify` also runs `--boot` — see `new.ts`.
 *
 * @module
 */

import { join } from "@std/path";
import { checkLockfileStaleness } from "./lockfile.ts";
import { formatNpmCacheMismatchError, isNpmCacheMismatchError } from "./npm-cache-error.ts";

export interface DoctorFinding {
  category: "deno-version" | "resolution" | "npm-cache" | "lockfile" | "boot";
  severity: "error" | "warning";
  message: string;
}

export interface DoctorRunOptions {
  /** Also spawn the site for real and make a request against it. */
  boot?: boolean;
}

const MIN_SUPPORTED_DENO_MAJOR = 2;

/** Pure so it's testable without stubbing the read-only `Deno.version` global. */
export function evaluateDenoVersion(version: string): DoctorFinding[] {
  const major = parseInt(version.split(".")[0] ?? "", 10);
  if (Number.isNaN(major) || major < MIN_SUPPORTED_DENO_MAJOR) {
    return [{
      category: "deno-version",
      severity: "error",
      message: `Deno ${version} detected — Dune requires Deno ${MIN_SUPPORTED_DENO_MAJOR}.x or newer.`,
    }];
  }
  return [];
}

async function checkLockfile(root: string): Promise<DoctorFinding[]> {
  if (await checkLockfileStaleness(root)) {
    return [{
      category: "lockfile",
      severity: "warning",
      message: "deno.lock may be incomplete. Run `dune lockfile:sync` before deploying.",
    }];
  }
  return [];
}

/**
 * Resolves the site's dependency graph the same way `dev`/`serve` would on
 * first boot, but ahead of time. Catches both plain resolution failures and
 * the npm-cache-mismatch error class (duneorg/dune#2) — reusing the same
 * detection/formatting `cli.ts`'s reactive error handler uses, so a
 * proactive `doctor` run and a live crash report the same fix.
 */
async function checkResolution(root: string): Promise<DoctorFinding[]> {
  const mainTsPath = join(root, "main.ts");
  try {
    await Deno.stat(mainTsPath);
  } catch {
    // No generated entrypoint (a pre-entrypoint-migration site) — nothing
    // to resolve against. Not an error: `dune migrate:entrypoint` is a
    // separate, opt-in concern from doctor's own checks.
    return [];
  }

  const cmd = new Deno.Command(Deno.execPath(), {
    args: ["cache", "main.ts"],
    cwd: root,
    env: { ...Deno.env.toObject(), NO_COLOR: "1" },
    stdout: "null",
    stderr: "piped",
  });
  const { code, stderr } = await cmd.output();
  if (code === 0) return [];

  const stderrText = new TextDecoder().decode(stderr).trim();
  const err = new Error(stderrText);
  if (isNpmCacheMismatchError(err)) {
    return [{ category: "npm-cache", severity: "error", message: formatNpmCacheMismatchError(err) }];
  }
  return [{
    category: "resolution",
    severity: "error",
    message: `Dependency resolution failed:\n${stderrText}`,
  }];
}

/** Bind to an ephemeral port and immediately release it, for the boot check. */
async function findFreePort(): Promise<number> {
  const listener = Deno.listen({ port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();
  return port;
}

const BOOT_TIMEOUT_MS = 20_000;
const BOOT_POLL_INTERVAL_MS = 250;

/**
 * Actually spawns `main.ts dev` and makes a real HTTP request against it —
 * the only check here that exercises the full boot path (Fresh's
 * Builder/esbuild integration included), matching the exact shape of #2's
 * original failure. Slow and occasionally flaky (port binding, timeouts)
 * relative to the other checks, hence opt-in.
 */
async function runBootCheck(root: string): Promise<DoctorFinding[]> {
  const mainTsPath = join(root, "main.ts");
  try {
    await Deno.stat(mainTsPath);
  } catch {
    return [{
      category: "boot",
      severity: "warning",
      message: "No main.ts found — skipping boot check (run `dune migrate:entrypoint` first).",
    }];
  }

  const port = await findFreePort();
  const cmd = new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", "main.ts", "dev", "--port", String(port)],
    cwd: root,
    stdout: "piped",
    stderr: "piped",
  });
  const child = cmd.spawn();

  let output = "";
  const drain = async (stream: ReadableStream<Uint8Array>) => {
    const decoder = new TextDecoder();
    for await (const chunk of stream) output += decoder.decode(chunk);
  };
  const stdoutDone = drain(child.stdout);
  const stderrDone = drain(child.stderr);

  let exited = false;
  child.status.then(() => { exited = true; });

  let ok = false;
  try {
    const deadline = Date.now() + BOOT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (exited) break;
      try {
        const res = await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(2000) });
        ok = res.status < 500;
        break;
      } catch {
        await new Promise((r) => setTimeout(r, BOOT_POLL_INTERVAL_MS));
      }
    }
  } finally {
    try {
      child.kill("SIGTERM");
    } catch {
      // already exited
    }
    await child.status.catch(() => {});
    await stdoutDone.catch(() => {});
    await stderrDone.catch(() => {});
  }

  if (!ok) {
    return [{
      category: "boot",
      severity: "error",
      message: `Site did not boot and serve a response within ${BOOT_TIMEOUT_MS}ms.\n${output.trim()}`,
    }];
  }
  return [];
}

/** Run doctor's checks and return the findings, without printing or exiting. */
export async function runDoctorChecks(root: string, opts: DoctorRunOptions = {}): Promise<DoctorFinding[]> {
  const findings: DoctorFinding[] = [
    ...evaluateDenoVersion(Deno.version.deno),
    ...await checkLockfile(root),
    ...await checkResolution(root),
  ];
  if (opts.boot) {
    findings.push(...await runBootCheck(root));
  }
  return findings;
}

/** Print findings in the same human-readable shape `doctorCommand` and `dune new` both use. */
export function printDoctorFindings(findings: DoctorFinding[], opts: { boot?: boolean } = {}): void {
  if (findings.length === 0) {
    console.log("  ✅ Everything looks healthy.");
  } else {
    for (const f of findings) {
      const icon = f.severity === "error" ? "✗" : "⚠";
      console.log(`  ${icon} [${f.category}] ${f.message}\n`);
    }
  }
  if (!opts.boot) {
    console.log(`  (Run "dune doctor --boot" to also verify the site actually boots and serves a request.)`);
  }
}

export interface DoctorCommandOptions {
  boot?: boolean;
  json?: boolean;
}

export async function doctorCommand(root: string, opts: DoctorCommandOptions = {}): Promise<void> {
  if (!opts.json) {
    console.log("🏜️  Dune — running doctor checks...\n");
  }

  const findings = await runDoctorChecks(root, { boot: opts.boot });
  const ok = !findings.some((f) => f.severity === "error");

  if (opts.json) {
    console.log(JSON.stringify({ ok, findings }));
    Deno.exit(ok ? 0 : 1);
    return;
  }

  printDoctorFindings(findings, { boot: opts.boot });
  Deno.exit(ok ? 0 : 1);
}
