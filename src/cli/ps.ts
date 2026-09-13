/**
 * dune ps — list dune dev/serve instances currently running on this machine.
 *
 * Finds candidates by matching the process table against the generated
 * entrypoint invocation shape (`deno run ... main.ts dev|serve` — the
 * pattern every `dune new` scaffold's `deno task dev`/`serve` runs, see
 * `entrypoint-template.ts`'s `ENTRYPOINT_TASKS`), confirms each match is a
 * real dune site by checking `config/site.yaml` exists at its site root,
 * and reports the port(s) it's *actually* listening on — read from that
 * process's own open sockets via `lsof`, never assumed from a fixed list
 * of "common" ports.
 *
 * Site-root detection prefers a process's `PWD` environment variable over
 * its live cwd — `dev.ts` deliberately `Deno.chdir()`s to `@dune/core`'s
 * own package root when running from a local checkout (for Fresh's
 * esbuild import-map auto-detection), which would otherwise make a
 * maintainer's own dev setup — running dune from source against a real
 * site — misreport as "not a dune site" (see `getPwdEnv()`'s doc comment).
 *
 * POSIX only (macOS/Linux) — both `ps` and `lsof` are used. Deliberately
 * process-table-scanning rather than a self-registered PID/state file:
 * that would need `dev.ts`/`serve.ts` to register on startup, so it could
 * only ever find instances started after this feature shipped. Scanning
 * works retroactively on anything already running.
 *
 * @module
 */

import { join } from "@std/path";
import { parseUserYaml } from "../security/safe-yaml.ts";

/** A dune dev/serve-shaped process found running on this machine. */
export interface DuneInstance {
  pid: number;
  mode: "dev" | "serve" | "unknown";
  /**
   * Absolute path to the site root, or null when neither `PWD` nor the
   * live cwd could be confirmed as a real dune site (`config/site.yaml`
   * missing from both) — still a real process worth reporting, just
   * without a confirmed identity.
   */
  root: string | null;
  /** `config/site.yaml`'s `title`, or null if unset/unreadable/`root` is null. */
  title: string | null;
  /** Ports this process is actually listening on, ascending. Empty if `lsof` couldn't tell us (e.g. not installed). */
  ports: number[];
  /** `ps`'s own elapsed-time string (e.g. "01:23:45" or "2-09:03:55"). */
  elapsed: string | null;
}

async function runCommand(
  cmd: string,
  args: string[],
  env?: Record<string, string>,
): Promise<string | null> {
  try {
    const command = new Deno.Command(cmd, {
      args,
      stdout: "piped",
      stderr: "null",
      env,
    });
    const { code, stdout } = await command.output();
    if (code !== 0) return null;
    return new TextDecoder().decode(stdout);
  } catch {
    // Binary not found, no permission, etc. — treat as "can't tell", not fatal.
    return null;
  }
}

/**
 * Every process on the machine matching the dune dev/serve invocation
 * shape, with PID and elapsed time straight from `ps` (one call, so we
 * don't pay a subprocess per candidate for this part).
 *
 * `COLUMNS=4096` works around BSD `ps` (macOS) truncating the `command`
 * column to terminal width by default — without it, a long `deno run -A
 * --watch=main.ts main.ts dev` invocation from a deeply-nested path can get
 * cut off before the trailing `dev`/`serve` token this match depends on.
 */
async function findCandidates(): Promise<
  { pid: number; elapsed: string; command: string }[]
> {
  const out = await runCommand("ps", ["-eo", "pid=,etime=,command="], {
    COLUMNS: "4096",
  });
  if (!out) return [];

  const results: { pid: number; elapsed: string; command: string }[] = [];
  for (const line of out.split("\n")) {
    const match = line.match(/^\s*(\d+)\s+(\S+)\s+(.*)$/);
    if (!match) continue;
    const [, pidStr, elapsed, command] = match;
    if (!command.includes("deno")) continue;
    if (!/\bmain\.ts\s+(dev|serve)\b/.test(command)) continue;
    results.push({ pid: parseInt(pidStr, 10), elapsed, command });
  }
  return results;
}

/**
 * Extract one env var's value from `ps eww`'s raw dump. There's no
 * delimiter between the command and its environment in that output (both
 * are one space-joined string), and some real values (e.g. `PATH`, on a
 * machine with a space in some directory name) contain spaces themselves
 * — so this is a heuristic, not a real parser: it stops at the next token
 * that looks like `NAME=` (an all-caps/underscore key), which is right
 * for the overwhelming majority of real values, `PWD` included.
 */
function extractEnvVar(psOutput: string, name: string): string | null {
  const re = new RegExp(`\\s${name}=(.*?)(?:\\s[A-Z_][A-Z0-9_]*=|$)`);
  const match = psOutput.match(re);
  return match ? match[1] : null;
}

/**
 * The process's `PWD` environment variable, as captured at launch — a
 * snapshot from `ps eww`, not a live query. Preferred over the live cwd
 * (`getLiveCwd()`) as the site-root signal: `dev.ts` deliberately
 * `Deno.chdir()`s to `@dune/core`'s own package root when running from a
 * local `file://` checkout (so Fresh's esbuild import-map auto-detection
 * finds dune's own `deno.json`) — a real, documented behavior, not a bug —
 * which means the *live* cwd reports the wrong directory for exactly that
 * case: a maintainer running dune from a local checkout against a real
 * site, which is common on a dev machine that also develops dune itself.
 * `PWD` isn't touched by anything the process does internally afterward,
 * so it survives that chdir. Null when the process has no `PWD` at all
 * (e.g. launched without a shell, by a process manager that doesn't
 * export it) — `getLiveCwd()` is the fallback for that case.
 */
async function getPwdEnv(pid: number): Promise<string | null> {
  const envOut = await runCommand("ps", ["eww", "-p", String(pid), "-o", "command="]);
  return envOut ? extractEnvVar(envOut, "PWD") : null;
}

/** The process's actual, current (post-any-internal-chdir) working directory. */
async function getLiveCwd(pid: number): Promise<string | null> {
  if (Deno.build.os === "linux") {
    try {
      return await Deno.readLink(`/proc/${pid}/cwd`);
    } catch {
      return null;
    }
  }
  // macOS (and any other platform with lsof but no /proc).
  const out = await runCommand("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]);
  if (!out) return null;
  for (const line of out.split("\n")) {
    if (line.startsWith("n")) return line.slice(1);
  }
  return null;
}

/**
 * Every descendant PID of `pid` (children, grandchildren, ...), via
 * repeated `pgrep -P`. Needed because `dune dev`/`serve`'s *matched*
 * process is not always the one holding the listening socket: when a site
 * resolves `@dune/core` from JSR (the common case — anything that isn't a
 * maintainer's own local-checkout dev setup), `maybeReexecWithSiteConfig()`
 * re-execs into a **child** process (to apply the site's merged
 * `deno.json`/import map) that actually calls `bootstrap()` and binds the
 * port — the original, outer process (the one whose command line matches
 * `main.ts dev|serve`) is a thin wrapper that doesn't hold the socket at
 * all. Checking descendants too is what makes port lookup work for both
 * that case and the local-checkout case (no re-exec, the matched PID
 * *is* the listener) uniformly.
 */
async function getDescendantPids(pid: number): Promise<number[]> {
  const all: number[] = [];
  let frontier = [pid];
  // Bounded depth, not because deep re-exec chains are expected, but so a
  // pathological/cyclic ps report can't spin this into an infinite loop.
  for (let depth = 0; depth < 5 && frontier.length > 0; depth++) {
    const out = await runCommand("pgrep", ["-P", frontier.join(",")]);
    if (!out) break;
    const children = out.split("\n").map((s) => parseInt(s.trim(), 10)).filter((n) =>
      !isNaN(n)
    );
    if (children.length === 0) break;
    all.push(...children);
    frontier = children;
  }
  return all;
}

/**
 * Ports this process — or any of its descendants (see `getDescendantPids`)
 * — is actually bound to and listening on (TCP), ascending. `-P` forces
 * numeric port output — without it, `lsof` resolves a port to its
 * `/etc/services` name when one happens to be registered (port 3000
 * prints as `hbci` on macOS, not `3000`), which would silently break the
 * numeric parse below for exactly the port `dune new` defaults to.
 */
async function getListeningPorts(pid: number): Promise<number[]> {
  const descendants = await getDescendantPids(pid);
  const pids = [pid, ...descendants];
  const out = await runCommand("lsof", [
    "-a",
    "-p",
    pids.join(","),
    "-iTCP",
    "-sTCP:LISTEN",
    "-P",
    "-Fn",
  ]);
  if (!out) return [];
  const ports = new Set<number>();
  for (const line of out.split("\n")) {
    if (!line.startsWith("n")) continue;
    const match = line.match(/:(\d+)$/);
    if (match) ports.add(parseInt(match[1], 10));
  }
  return [...ports].sort((a, b) => a - b);
}

/** `config/site.yaml`'s `title` field, or null if the file is missing/unreadable/has no title. */
async function readSiteTitle(root: string): Promise<string | null> {
  try {
    const text = await Deno.readTextFile(join(root, "config", "site.yaml"));
    const parsed = parseUserYaml(text);
    if (parsed && typeof parsed === "object" && "title" in parsed) {
      const title = (parsed as Record<string, unknown>).title;
      if (typeof title === "string") return title;
    }
    return null;
  } catch {
    return null;
  }
}

function modeFromCommand(command: string): DuneInstance["mode"] {
  if (/\bmain\.ts\s+dev\b/.test(command)) return "dev";
  if (/\bmain\.ts\s+serve\b/.test(command)) return "serve";
  return "unknown";
}

/**
 * Confirm `dir` (or, failing that, `fallbackDir`) is a real dune site —
 * `config/site.yaml` exists there — and return whichever one actually is.
 * Tries `dir` (normally the `PWD`-derived root) first since it's right for
 * the common `Deno.chdir()` case `getPwdEnv()`'s doc comment describes;
 * falls back to the live cwd for anything `PWD` got wrong. Returns null
 * when neither pans out — the caller still reports the process, just
 * without a confirmed site identity, rather than silently dropping it.
 */
async function confirmSiteRoot(
  dir: string | null,
  fallbackDir: string | null,
): Promise<string | null> {
  for (const candidate of [dir, fallbackDir]) {
    if (!candidate) continue;
    try {
      await Deno.stat(join(candidate, "config", "site.yaml"));
      return candidate;
    } catch { /* try the next candidate */ }
  }
  return null;
}

/**
 * Find every dune dev/serve-shaped process on this machine.
 *
 * A process-table match is reported unconditionally — even when neither
 * `PWD` nor the live cwd turns out to hold a `config/site.yaml`, since
 * that's still useful signal (PID, port, uptime) rather than a false
 * negative — but `root`/`title` are null in that case, and the caller
 * should say so plainly rather than guessing.
 */
export async function findDuneInstances(): Promise<DuneInstance[]> {
  const candidates = await findCandidates();
  const instances: DuneInstance[] = [];

  for (const { pid, elapsed, command } of candidates) {
    const [pwdRoot, liveCwd] = await Promise.all([getPwdEnv(pid), getLiveCwd(pid)]);
    const root = await confirmSiteRoot(pwdRoot, liveCwd);

    const [title, ports] = await Promise.all([
      root ? readSiteTitle(root) : Promise.resolve(null),
      getListeningPorts(pid),
    ]);

    instances.push({
      pid,
      mode: modeFromCommand(command),
      root,
      title,
      ports,
      elapsed,
    });
  }

  return instances;
}

export async function psCommand(): Promise<void> {
  if (Deno.build.os === "windows") {
    console.log(
      "  ⚠  `dune ps` needs `ps`/`lsof` and isn't supported on Windows yet.",
    );
    return;
  }

  console.log("🏜️  Dune — scanning for running instances...\n");
  const instances = await findDuneInstances();

  if (instances.length === 0) {
    console.log("  No dune dev/serve instances found running locally.");
    return;
  }

  for (const inst of instances) {
    const portsStr = inst.ports.length > 0
      ? inst.ports.map((p) => `http://localhost:${p}`).join(", ")
      : "(port unknown — is `lsof` installed?)";
    console.log(`  PID ${inst.pid}  ${inst.mode.padEnd(5)}  up ${inst.elapsed ?? "?"}`);
    console.log(`    ${inst.title ?? "(untitled)"}`);
    console.log(
      `    ${inst.root ?? "(site root unconfirmed — config/site.yaml not found via PWD or live cwd)"}`,
    );
    console.log(`    ${portsStr}\n`);
  }
}
