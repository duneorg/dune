/**
 * Reap this process's own `esbuild --service` workers when the runtime unloads.
 *
 * Generated sites run `dune dev` as `deno run --watch=main.ts main.ts dev`.
 * Deno's `--watch` restarts the program *inside the same OS process* and
 * watches the entrypoint's whole local module graph — for a workspace-linked
 * site that's all of dune's own source. Each restart re-imports Fresh's
 * esbuild (a fresh module instance with its own long-lived `--service` child)
 * while the previous runtime's child is never terminated: one leaked worker
 * per restart, all children of the same live PID, all reaped only when that
 * process finally exits (duneorg/dune#22).
 *
 * Calling `esbuild.stop()` would only reach Fresh's instance if dune imported
 * esbuild at exactly Fresh's pinned version, and would silently stop working
 * the day Fresh bumps it. Reaping our own direct children by command line
 * has no such coupling.
 *
 * @module
 */

/** PIDs of `ppid`'s direct children running `esbuild --service`, from `ps -eo pid=,ppid=,command=` output. */
export function findOwnEsbuildWorkers(psOutput: string, ppid: number): number[] {
  const pids: number[] = [];
  for (const line of psOutput.split("\n")) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
    if (!match) continue;
    const [, pid, parent, command] = match;
    if (Number(parent) !== ppid) continue;
    if (!/(^|\/)esbuild(\.exe)?\s/.test(command) || !command.includes("--service")) continue;
    pids.push(Number(pid));
  }
  return pids;
}

function killOwnEsbuildWorkers(): void {
  try {
    // Sync: an unload listener can't await anything.
    const { code, stdout } = new Deno.Command("ps", {
      args: ["-eo", "pid=,ppid=,command="],
      stdout: "piped",
      stderr: "null",
    }).outputSync();
    if (code !== 0) return;
    for (const pid of findOwnEsbuildWorkers(new TextDecoder().decode(stdout), Deno.pid)) {
      try {
        Deno.kill(pid, "SIGTERM");
      } catch {
        // already gone
      }
    }
  } catch {
    // ps unavailable — nothing we can do, and never worth failing an unload over
  }
}

let registered = false;

/** Register the unload-time reaper once per runtime. POSIX only (uses `ps`). */
export function registerEsbuildWorkerCleanup(): void {
  if (registered || Deno.build.os === "windows") return;
  registered = true;
  globalThis.addEventListener("unload", killOwnEsbuildWorkers);
}
