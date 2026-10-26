/**
 * Instance registry.
 *
 * `dune dev` / `dune serve` record themselves in a per-user directory so tools
 * (`dune ps`) can list running instances from what each one says about
 * itself instead of guessing from process command lines and `lsof`, which
 * misses processes started in unexpected ways and says nothing about whether
 * one is healthy.
 *
 * One JSON file per process: `<registry dir>/<pid>.json`. A process removes
 * its file on a graceful exit, but a SIGKILL, crash or default signal
 * termination leaves it behind, so every reader verifies a record against the
 * live process (pid exists *and* has the recorded start time, since pids are
 * reused) and prunes the ones that fail.
 *
 * The directory is `~/.dune/instances`, overridable with `DUNE_REGISTRY_DIR`
 * (tests; unusual setups). Nothing here may stop a server from starting: every
 * failure is swallowed. Unix only (like `dune ps`): where the process start time
 * can't be read there is nothing to verify a record against, so nothing is
 * written.
 *
 * @module
 */

import { join } from "@std/path";

export interface InstanceRecord {
  pid: number;
  /** The OS-reported start time of the process (`ps -o lstart=`). */
  processStart: string;
  mode: "dev" | "serve";
  /** Absolute site root. */
  root: string;
  title: string | null;
  /** The port the server was asked to listen on. */
  port: number | null;
  /** `@dune/core` version running. */
  version: string;
  /** ISO timestamp of registration. */
  registeredAt: string;
}

export type InstanceInit = Pick<InstanceRecord, "mode" | "root" | "title" | "port" | "version">;

export interface InstanceHandle {
  /** Remove this process's record. Safe to call more than once. */
  unregister(): void;
}

/** Where records live. */
export function registryDir(): string {
  const override = Deno.env.get("DUNE_REGISTRY_DIR");
  if (override) return override;
  const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? "";
  return join(home, ".dune", "instances");
}

/**
 * The OS-reported start time of `pid`, or null when it can't be read (not a
 * Unix `ps`, process gone). Compared as an opaque string: only equality with
 * an earlier reading of the same process matters.
 */
export async function readProcessStart(pid: number): Promise<string | null> {
  if (Deno.build.os === "windows") return null;
  try {
    const out = await new Deno.Command("ps", {
      args: ["-o", "lstart=", "-p", String(pid)],
      stdout: "piped",
      stderr: "null",
    }).output();
    if (!out.success) return null;
    const text = new TextDecoder().decode(out.stdout).trim();
    return text || null;
  } catch {
    return null;
  }
}

function fileFor(dir: string, pid: number): string {
  return join(dir, `${pid}.json`);
}

/**
 * Record this process. Never throws: a registry that can't be written must not
 * keep a site from starting. The record is written atomically (temp file +
 * rename) so a reader never sees half a file.
 */
export async function registerInstance(init: InstanceInit): Promise<InstanceHandle> {
  const dir = registryDir();
  const file = fileFor(dir, Deno.pid);
  let removed = false;
  const unregister = () => {
    if (removed) return;
    removed = true;
    try {
      Deno.removeSync(file);
    } catch { /* already gone, or never written */ }
  };

  try {
    const processStart = await readProcessStart(Deno.pid);
    if (processStart === null) {
      removed = true;
      return { unregister };
    }
    const record: InstanceRecord = {
      pid: Deno.pid,
      processStart,
      ...init,
      registeredAt: new Date().toISOString(),
    };
    await Deno.mkdir(dir, { recursive: true });
    const tmp = `${file}.${crypto.randomUUID()}.tmp`;
    await Deno.writeTextFile(tmp, JSON.stringify(record, null, 2) + "\n");
    await Deno.rename(tmp, file);
    // A graceful or natural exit cleans up; anything else leaves a stale file
    // that readers prune.
    globalThis.addEventListener("unload", unregister);
  } catch {
    removed = true; // nothing to clean up
  }
  return { unregister };
}

function isRecord(value: unknown): value is InstanceRecord {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return typeof r.pid === "number" && typeof r.root === "string" &&
    typeof r.processStart === "string" &&
    (r.mode === "dev" || r.mode === "serve") && typeof r.version === "string";
}

/**
 * Registered instances that are still running. Records for dead processes, or
 * whose pid now belongs to a different process, are deleted as they are found.
 */
export async function listRegisteredInstances(): Promise<InstanceRecord[]> {
  const dir = registryDir();
  const live: InstanceRecord[] = [];
  let entries: Deno.DirEntry[];
  try {
    entries = [];
    for await (const e of Deno.readDir(dir)) entries.push(e);
  } catch {
    return live; // no registry yet
  }

  for (const entry of entries) {
    if (!entry.isFile || !/^\d+\.json$/.test(entry.name)) continue;
    const file = join(dir, entry.name);
    let record: InstanceRecord | null = null;
    try {
      const parsed: unknown = JSON.parse(await Deno.readTextFile(file));
      if (isRecord(parsed) && `${parsed.pid}.json` === entry.name) record = parsed;
    } catch { /* unreadable or half-written: treated as stale below */ }

    // Alive AND the same process: pids are reused, so a live pid with a
    // different start time is someone else's process and this record is stale.
    const valid = record !== null &&
      (await readProcessStart(record.pid)) === record.processStart;
    if (valid && record) {
      live.push(record);
    } else {
      try {
        await Deno.remove(file);
      } catch { /* raced with its owner or another reader */ }
    }
  }
  return live.sort((a, b) => a.pid - b.pid);
}
