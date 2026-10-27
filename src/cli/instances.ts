/**
 * Discovery of dune dev/serve instances running on this machine: what `dune ps`
 * lists and `dune stop` acts on.
 *
 * Finds candidates by matching the process table against the invocation
 * shapes dune servers actually run as:
 *   - the generated entrypoint: `deno run ... main.ts dev|serve` (what every
 *     `dune new` scaffold's `deno task dev`/`serve` runs, see
 *     `entrypoint-template.ts`'s `ENTRYPOINT_TASKS`);
 *   - the `dune` CLI itself: `deno run ... cli.ts dev|serve` (the global shim
 *     or a source checkout) and `jsr:@dune/core@x/cli serve`;
 *   - the `deno task dev|serve` wrapper around either of those.
 * Each match is then confirmed as a real dune site by checking `config/site.yaml`
 * at its root, and reported with the port(s) it is *actually* listening on —
 * read from that process's own open sockets via `lsof`, never assumed from a
 * fixed list of "common" ports.
 *
 * A server is usually several processes (a `deno task` wrapper, the re-exec
 * child that applies the site's import map, esbuild workers). They are
 * reported as ONE instance, keyed by the topmost matching process, and
 * `dune stop` stops the whole tree.
 *
 * Site-root detection prefers an explicit `--root`, then the process's `PWD`
 * environment variable, then its live cwd — `dev.ts` deliberately
 * `Deno.chdir()`s to `@dune/core`'s own package root when running from a local
 * checkout (for Fresh's esbuild import-map auto-detection), which would
 * otherwise make a maintainer's own dev setup misreport as "not a dune site"
 * (see `getPwdEnv()`'s doc comment).
 *
 * A process can match and still be listening on nothing — typically a server
 * started on a port something else already held, which never exits. That is
 * reported as "not listening", distinct from "port unknown" (no `lsof`).
 *
 * POSIX only (macOS/Linux) — both `ps` and `lsof` are used. Deliberately
 * process-table-scanning rather than a self-registered PID/state file:
 * that would need `dev.ts`/`serve.ts` to register on startup, so it could
 * only ever find instances started after this feature shipped. Scanning
 * works retroactively on anything already running.
 *
 * @module
 */

import { dirname, fromFileUrl, isAbsolute, join, resolve } from "@std/path";
import { parseUserYaml } from "../security/safe-yaml.ts";

/** A dune dev/serve-shaped process (tree) found running on this machine. */
export interface DuneInstance {
  /** The topmost matching process; what `dune stop <pid>` and humans refer to. */
  pid: number;
  /** `pid` plus every descendant (re-exec child, esbuild workers, ...). */
  pids: number[];
  mode: "dev" | "serve" | "unknown";
  /**
   * Absolute path to the site root, or null when no candidate directory
   * (`--root`, `PWD`, live cwd) held a `config/site.yaml` — still a real
   * process worth reporting, just without a confirmed identity.
   */
  root: string | null;
  /** `config/site.yaml`'s `title`, or null if unset/unreadable/`root` is null. */
  title: string | null;
  /** Ports this instance is actually listening on, ascending. */
  ports: number[];
  /**
   * `"listening"`: at least one port. `"not-listening"`: `lsof` ran and found
   * none — a hung or leftover process. `"unknown"`: `lsof` isn't available,
   * so we can't tell.
   */
  portStatus: "listening" | "not-listening" | "unknown";
  /** `ps`'s own elapsed-time string (e.g. "01:23:45" or "2-09:03:55"). */
  elapsed: string | null;
  /** `elapsed` in seconds, or null when unparseable. */
  ageSeconds: number | null;
  /**
   * True when this is verifiably a dune site (a `config/site.yaml` was found at
   * its root). A command-line match alone is only a guess — any other Deno
   * project can run `main.ts serve` — so `dune stop --all/--idle` never act on
   * an unconfirmed instance; it must be named by pid.
   */
  confirmed: boolean;
  /**
   * Start time of every pid in `pids` as read when this instance was found.
   * `dune stop` re-checks each one right before signalling, so a pid that
   * exited and was reused by an unrelated process in the meantime is left alone.
   */
  startTimes: Record<number, string>;
  /** The process's command line, for identifying unconfirmed instances. */
  command: string;
}

/** Deno's permission system refused something `dune ps`/`dune stop` needs. */
export class MissingPermissionError extends Error {}

export async function runCommand(
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
  } catch (err) {
    // Deno's own permission system refusing is not "can't tell": silently
    // reporting no instances (or all pids as gone) would mislead.
    if (err instanceof Deno.errors.NotCapable) {
      throw new MissingPermissionError(
        `\`dune ps\`/\`dune stop\` need to run \`${cmd}\`: re-run with --allow-run (or -A).`,
      );
    }
    // Binary not found, etc. — treat as "can't tell", not fatal.
    return null;
  }
}


// ── Process table ────────────────────────────────────────────────────────────

export interface ProcRow {
  pid: number;
  ppid: number;
  /** Owning user id. */
  uid: number;
  /** `ps`'s start time ("Mon Oct 26 15:38:49 2026"): with the pid, identifies one process for its whole life. */
  started: string;
  elapsed: string;
  command: string;
}

/** Seconds from `ps`'s elapsed-time string ("05:12", "01:23:45", "2-09:03:55"); null if unparseable. */
export function parseElapsedSeconds(elapsed: string | null): number | null {
  if (!elapsed) return null;
  const m = elapsed.match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/);
  if (!m) return null;
  return (Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0)) * 3600 + Number(m[3]) * 60 + Number(m[4]);
}

/**
 * Snapshot of the whole process table with parent links, so a server's
 * wrapper/child/worker processes can be grouped without further spawns.
 *
 * `COLUMNS=4096` works around BSD `ps` (macOS) truncating the `command`
 * column to terminal width by default — without it, a long `deno run -A
 * --watch=main.ts main.ts dev` invocation from a deeply-nested path can get
 * cut off before the trailing `dev`/`serve` token the match depends on.
 */
export async function readProcessTable(): Promise<ProcRow[]> {
  const out = await runCommand("ps", ["-eo", "pid=,ppid=,uid=,lstart=,etime=,command="], {
    COLUMNS: "4096",
  });
  if (!out) return [];
  const rows: ProcRow[] = [];
  for (const line of out.split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+[\d:]+\s+\d{4})\s+(\S+)\s+(.*)$/);
    if (!m) continue;
    rows.push({
      pid: parseInt(m[1], 10),
      ppid: parseInt(m[2], 10),
      uid: parseInt(m[3], 10),
      started: m[4].replace(/\s+/g, " "),
      elapsed: m[5],
      command: m[6],
    });
  }
  return rows;
}

/** How a command line matched: `strong` is unambiguous, `weak` needs a confirmed site. */
export interface CommandMatch {
  mode: "dev" | "serve";
  strength: "strong" | "weak";
  /** Which invocation shape matched; decides how the site root is read from the command line. */
  kind: "entry" | "cli" | "task";
}

const DENO_EXE = /^(?:\S*\/)?deno\s/;

/**
 * Does this command line look like a dune dev/serve server?
 *
 * - `main.ts dev|serve` — the generated site entrypoint. Strong.
 * - `cli.ts dev|serve` / `.../cli dev|serve` — the dune CLI run directly: the
 *   global shim, a source checkout, or `jsr:@dune/core/cli`. Strong when
 *   "dune" appears in the command (path, `@dune/core` specifier,
 *   `.dune-cli-config`); otherwise (a relative `src/cli.ts dev`) it could be
 *   any tool's CLI, so Weak.
 * - `deno task dev|serve` — only a wrapper around one of the above, and
 *   generic enough to be any project's task, so Weak.
 *
 * A weak match counts only when its site root is confirmed (`config/site.yaml`).
 */
export function matchDuneCommand(command: string): CommandMatch | null {
  if (!DENO_EXE.test(command)) return null;

  const entry = command.match(/\bmain\.ts\s+(dev|serve)\b/);
  if (entry) return { mode: entry[1] as "dev" | "serve", strength: "strong", kind: "entry" };

  const cli = command.match(/(?:^|[\s/])cli(?:\.ts)?\s+(dev|serve)\b/);
  if (cli) {
    return { mode: cli[1] as "dev" | "serve", strength: /dune/i.test(command) ? "strong" : "weak", kind: "cli" };
  }

  const task = command.match(/\bdeno\s+task\s+(dev|serve)\b/);
  if (task) return { mode: task[1] as "dev" | "serve", strength: "weak", kind: "task" };

  return null;
}

/** `--root <dir>` / `--root=<dir>` from a command line, or null. */
export function parseRootArg(command: string): string | null {
  const m = command.match(/--root(?:=|\s+)("[^"]+"|'[^']+'|\S+)/);
  return m ? m[1].replace(/^["']|["']$/g, "") : null;
}

/**
 * The site root the command line itself points at, or null. This is the strict
 * evidence behind "confirmed": a process merely *running from inside* a site
 * directory (its `PWD` or cwd) proves nothing, since any tool started from a
 * site repo inherits that.
 *   - `--root <dir>`, when given;
 *   - the generated entrypoint: the directory holding the `main.ts` it runs
 *     (`cli({ root: import.meta.dirname })`), however the process was started;
 *   - the dune CLI proper: its working directory, since `dune dev` defaults
 *     `--root` to `.`;
 *   - nothing for a bare `deno task` wrapper (its child carries the evidence).
 * `base` is the process's PWD/cwd, used to resolve relative paths.
 */
export function commandSiteRootHint(command: string, match: CommandMatch, base: string | null): string | null {
  const rootArg = parseRootArg(command);
  if (rootArg) return isAbsolute(rootArg) ? rootArg : base ? resolve(base, rootArg) : null;
  if (match.kind === "entry") {
    const m = command.match(/(\S*main\.ts)\s+(?:dev|serve)\b/);
    if (!m) return null;
    let script = m[1].replace(/^["']|["']$/g, "");
    if (script.startsWith("file://")) {
      try {
        script = fromFileUrl(script);
      } catch {
        return null;
      }
    }
    if (isAbsolute(script)) return dirname(script);
    return base ? dirname(resolve(base, script)) : null;
  }
  if (match.kind === "cli" && match.strength === "strong") return base;
  return null;
}

/** All descendant pids of `pid`, from an in-memory process table. */
function descendantsOf(pid: number, children: Map<number, number[]>): number[] {
  const out: number[] = [];
  const seen = new Set<number>([pid]);
  const queue = [pid];
  while (queue.length > 0) {
    for (const child of children.get(queue.shift()!) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      out.push(child);
      queue.push(child);
    }
  }
  return out;
}

// ── lsof ─────────────────────────────────────────────────────────────────────

let lsofAvailableCache: boolean | undefined;

/** Whether `lsof` can be spawned at all (its exit code is irrelevant: it exits 1 on "no matches"). */
async function lsofAvailable(): Promise<boolean> {
  if (lsofAvailableCache !== undefined) return lsofAvailableCache;
  try {
    await new Deno.Command("lsof", { args: ["-v"], stdout: "null", stderr: "null" }).output();
    lsofAvailableCache = true;
  } catch {
    lsofAvailableCache = false;
  }
  return lsofAvailableCache;
}

/**
 * Ports any of `pids` is actually bound to and listening on (TCP), ascending.
 * `-P` forces numeric port output — without it, `lsof` resolves a port to its
 * `/etc/services` name when one happens to be registered (port 3000 prints as
 * `hbci` on macOS, not `3000`), which would silently break the numeric parse
 * below for exactly the port `dune new` defaults to.
 */
async function getListeningPorts(pids: number[]): Promise<number[]> {
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


/**
 * First directory among `dirs` that holds a `config/site.yaml`, or null.
 * `--root` first (explicit), then `PWD` (right for the `Deno.chdir()` case
 * `getPwdEnv()` describes), then the live cwd.
 */
async function confirmSiteRoot(dirs: (string | null)[]): Promise<string | null> {
  for (const candidate of dirs) {
    if (!candidate) continue;
    try {
      await Deno.stat(join(candidate, "config", "site.yaml"));
      return candidate;
    } catch { /* try the next candidate */ }
  }
  return null;
}

/**
 * Find every dune dev/serve instance on this machine.
 *
 * A process-table match is reported unconditionally — even when no candidate
 * directory holds a `config/site.yaml`, since that's still useful signal (PID,
 * port, uptime, command) rather than a false negative — but `root`/`title`
 * are null in that case, and the caller should say so plainly.
 */
export async function findDuneInstances(
  opts: { onWarning?: (message: string) => void } = {},
): Promise<DuneInstance[]> {
  const allRows = await readProcessTable();
  // Only this user's processes: another user's server is not ours to list or
  // signal (the kill would be refused anyway). Our own uid comes from our own
  // row in the table (Deno.uid() would need --allow-sys); if that row is
  // missing nothing can be filtered, and we say so.
  const myUid = allRows.find((r) => r.pid === Deno.pid)?.uid ?? null;
  if (myUid === null && allRows.length > 0) {
    opts.onWarning?.("Could not tell which user owns this process, so processes of other users are not filtered out.");
  }
  const table = myUid === null ? allRows : allRows.filter((r) => r.uid === myUid);
  const byPid = new Map(table.map((r) => [r.pid, r]));
  const children = new Map<number, number[]>();
  for (const r of table) children.set(r.ppid, [...(children.get(r.ppid) ?? []), r.pid]);

  // 1. Match command lines; resolve each match's site root.
  interface Cand extends ProcRow {
    match: CommandMatch;
    root: string | null;
  }
  /** A site root the command line itself points at (see commandSiteRootHint), verified on disk. */
  const strictRootOf = async (row: ProcRow, match: CommandMatch): Promise<string | null> => {
    const [pwd, cwd] = await Promise.all([getPwdEnv(row.pid), getLiveCwd(row.pid)]);
    const hint = commandSiteRootHint(row.command, match, pwd ?? cwd);
    return hint ? await confirmSiteRoot([hint]) : null;
  };
  const cands: Cand[] = [];
  for (const row of table) {
    const match = matchDuneCommand(row.command);
    if (!match) continue;
    const [pwdRoot, liveCwd] = await Promise.all([getPwdEnv(row.pid), getLiveCwd(row.pid)]);
    const rootArg = parseRootArg(row.command);
    const base = pwdRoot ?? liveCwd;
    const explicit = rootArg ? (isAbsolute(rootArg) ? rootArg : base ? resolve(base, rootArg) : null) : null;
    const root = await confirmSiteRoot([explicit, pwdRoot, liveCwd]);
    cands.push({ ...row, match, root });
  }

  // 2. A weak match (`deno task ...`) counts only for a confirmed dune site.
  const kept = cands.filter((c) => c.match.strength === "strong" || c.root !== null);
  const keptPids = new Set(kept.map((c) => c.pid));

  // 3. One instance per process tree: drop any match that has a matching ancestor.
  const hasKeptAncestor = (pid: number): boolean => {
    let cur = byPid.get(pid)?.ppid;
    for (let i = 0; cur && cur > 1 && i < 32; i++) {
      if (keptPids.has(cur)) return true;
      cur = byPid.get(cur)?.ppid;
    }
    return false;
  };
  const tops = kept.filter((c) => !hasKeptAncestor(c.pid));

  // 4. Build the instances.
  const haveLsof = await lsofAvailable();
  const instances: DuneInstance[] = [];
  for (const c of tops) {
    const pids = [c.pid, ...descendantsOf(c.pid, children)];
    // A tree's site root can sit on any member (e.g. the `--root` is on the child).
    // Confirmed only on evidence from the command line, never from where the
    // process happens to be running: any tool started from inside a site repo
    // inherits that directory. Any member of the tree can provide it (a
    // `deno task` wrapper has none of its own).
    let confirmedRoot = await strictRootOf(c, c.match);
    if (!confirmedRoot) {
      for (const pid of pids.slice(1)) {
        const row = byPid.get(pid);
        const childMatch = row ? matchDuneCommand(row.command) : null;
        if (row && childMatch) {
          confirmedRoot = await strictRootOf(row, childMatch);
          if (confirmedRoot) break;
        }
      }
    }
    let root = confirmedRoot ?? c.root;
    if (!root) {
      for (const pid of pids.slice(1)) {
        const row = byPid.get(pid);
        if (!row) continue;
        const [pwd, cwd] = await Promise.all([getPwdEnv(pid), getLiveCwd(pid)]);
        const arg = parseRootArg(row.command);
        const base = pwd ?? cwd;
        const explicit = arg ? (isAbsolute(arg) ? arg : base ? resolve(base, arg) : null) : null;
        root = await confirmSiteRoot([explicit, pwd, cwd]);
        if (root) break;
      }
    }
    const [title, ports] = await Promise.all([
      root ? readSiteTitle(root) : Promise.resolve(null),
      haveLsof ? getListeningPorts(pids) : Promise.resolve([] as number[]),
    ]);
    instances.push({
      pid: c.pid,
      pids,
      mode: c.match.mode,
      root,
      title,
      ports,
      portStatus: !haveLsof ? "unknown" : ports.length > 0 ? "listening" : "not-listening",
      elapsed: c.elapsed,
      ageSeconds: parseElapsedSeconds(c.elapsed),
      confirmed: confirmedRoot !== null,
      startTimes: Object.fromEntries(pids.flatMap((p) => byPid.get(p) ? [[p, byPid.get(p)!.started]] : [])),
      command: c.command,
    });
  }
  return instances.sort((a, b) => a.pid - b.pid);
}
