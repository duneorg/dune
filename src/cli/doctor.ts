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
import { DOCTOR_REPORT_ENV, type DoctorReport } from "../plugin-api/doctor-report.ts";
import { formatNpmCacheMismatchError, isNpmCacheMismatchError } from "./npm-cache-error.ts";

export interface DoctorFinding {
  category: "deno-version" | "resolution" | "npm-cache" | "lockfile" | "boot" | "capabilities";
  /** `info` is context for the reader and never fails the run. */
  severity: "error" | "warning" | "info";
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

/**
 * A site can boot and still have search degraded: a search backend that was
 * down at startup is logged and retried, not fatal. `/health` says so; the
 * log line names the engine and the cause.
 */
export function searchDegradedFindings(healthStatus: unknown, bootOutput: string): DoctorFinding[] {
  if (healthStatus !== "degraded") return [];
  // deno-lint-ignore no-control-regex
  const failures = bootOutput.split("\n").map((l) => l.replace(/\x1b\[[0-9;]*m/g, ""))
    .filter((l) => l.includes("search.engine.failed"))
    .map((l) => `  ${l.trim()}`);
  return [{
    category: "boot",
    severity: "warning",
    message: "The site boots, but a search engine failed at startup. Search is served by the " +
      "fallback engine while Dune retries in the background." +
      (failures.length ? `\n${failures.join("\n")}` : ""),
  }];
}

/**
 * What the booted site's capability report means: who provides what, and
 * whether the setup is sound. Pure so it is testable without booting a site.
 *
 * - An enabled admin with no active `auth.session` is an error: the site
 *   boots, but there is no way to sign in and no admin bar, silently.
 * - A provider whose factory threw is an error: its slot is empty and the only
 *   other trace is a log line.
 * - Scheduled actions with no `scheduler.executor` are a warning: they are
 *   queued and nothing will ever run them.
 */
export function capabilityFindings(report: DoctorReport): DoctorFinding[] {
  const findings: DoctorFinding[] = [];
  const slot = (name: string) => report.providers.find((p) => p.kind === "slot" && p.name === name);

  if (report.providers.length > 0) {
    const lines = report.providers.map((p) => {
      const state = p.kind === "slot" && p.status !== "active" ? `  (${p.status})` : "";
      return `    ${p.name.padEnd(20)} ${p.provider}${state}`;
    });
    findings.push({ category: "capabilities", severity: "info", message: `What plugins provide:\n${lines.join("\n")}` });
  }

  for (const p of report.providers) {
    if (p.kind === "slot" && p.status === "failed") {
      findings.push({
        category: "capabilities",
        severity: "error",
        message: `${p.provider} provides "${p.name}" but its factory threw, so the slot is empty. ` +
          `See the "capabilities.provider_failed" line in the site's log for the error.`,
      });
    }
  }

  // A plugin that says it is the admin (it provides `admin.prefix`) but provides
  // no working `auth.session` is half installed: its pages exist and nobody can sign in.
  if (slot("admin.prefix") && slot("auth.session")?.status !== "active") {
    findings.push({
      category: "capabilities",
      severity: "error",
      message: `${slot("admin.prefix")!.provider} provides "admin.prefix" (it is an admin) but no plugin provides ` +
        `"auth.session", so nobody can sign in and no editing bar is shown.`,
    });
  }

  if (report.scheduledActions > 0 && slot("scheduler.executor")?.status !== "active") {
    findings.push({
      category: "capabilities",
      severity: "warning",
      message: `${report.scheduledActions} scheduled action(s) are queued, but no plugin provides ` +
        `"scheduler.executor", so none of them will ever run.`,
    });
  }
  return findings;
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
  const reportDir = await Deno.makeTempDir({ prefix: "dune_doctor_" });
  const reportPath = join(reportDir, "report.json");
  const cmd = new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", "main.ts", "dev", "--port", String(port)],
    cwd: root,
    env: { [DOCTOR_REPORT_ENV]: reportPath },
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
  let healthStatus: unknown;
  try {
    const deadline = Date.now() + BOOT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (exited) break;
      try {
        const res = await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(2000) });
        ok = res.status < 500;
        if (ok) {
          try {
            const health = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(2000) });
            healthStatus = (await health.json()).status;
          } catch { /* no /health: nothing to report */ }
        }
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

  let report: DoctorReport | null = null;
  try {
    report = JSON.parse(await Deno.readTextFile(reportPath)) as DoctorReport;
  } catch { /* reported below */ }
  await Deno.remove(reportDir, { recursive: true }).catch(() => {});

  if (!ok) {
    return [{
      category: "boot",
      severity: "error",
      message: `Site did not boot and serve a response within ${BOOT_TIMEOUT_MS}ms.\n${output.trim()}`,
    }];
  }
  const findings = searchDegradedFindings(healthStatus, output);
  if (!report) {
    findings.push({
      category: "capabilities",
      severity: "warning",
      message: "The site booted but did not report which plugins provide what (a site on an older @dune/core, " +
        "or a plugin load that never completed).",
    });
    return findings;
  }
  return [...findings, ...capabilityFindings(report)];
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
  if (!findings.some((f) => f.severity !== "info")) {
    console.log("  ✅ Everything looks healthy.\n");
  }
  for (const f of findings) {
    const icon = f.severity === "error" ? "✗" : f.severity === "warning" ? "⚠" : "ℹ";
    console.log(`  ${icon} [${f.category}] ${f.message}\n`);
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
