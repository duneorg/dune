/**
 * dune ps — list dune dev/serve instances currently running on this machine.
 *
 * Read-only: it never prompts and never signals anything. Stopping what it
 * lists is `dune stop` (stop.ts). Discovery lives in instances.ts.
 *
 * @module
 */

import { type DuneInstance, findDuneInstances, MissingPermissionError } from "./instances.ts";

/** Injection points so the command's output is testable without touching real processes. */
export interface PsDeps {
  find?: () => Promise<DuneInstance[]>;
  log?: (line: string) => void;
}

export function describePort(inst: DuneInstance): string {
  if (inst.portStatus === "listening") return inst.ports.map((p) => `http://localhost:${p}`).join(", ");
  if (inst.portStatus === "not-listening") return "not listening (no open port; likely a hung or leftover process)";
  return "port unknown (lsof not available)";
}

/** The lines `dune ps` prints for one instance (shared with `dune stop`, which shows what it is about to stop). */
export function formatInstance(inst: DuneInstance, opts: { fullCommand?: boolean } = {}): string[] {
  const extra = inst.pids.length > 1
    ? `  (+${inst.pids.length - 1} child process${inst.pids.length > 2 ? "es" : ""})`
    : "";
  return [
    `  PID ${inst.pid}  ${inst.mode.padEnd(5)}  up ${inst.elapsed ?? "?"}${extra}`,
    `    ${inst.title ?? "(untitled)"}`,
    `    ${inst.root ?? "(site root unconfirmed — no config/site.yaml via --root, PWD or live cwd)"}`,
    `    ${describePort(inst)}`,
    `    $ ${!opts.fullCommand && inst.command.length > 110 ? inst.command.slice(0, 107) + "..." : inst.command}`,
    ...(inst.confirmed ? [] : [`    (not confirmed as a dune site: no config/site.yaml at the root its command line points to)`]),
    "",
  ];
}

export async function psCommand(deps: PsDeps = {}): Promise<void> {
  const log = deps.log ?? ((l: string) => console.log(l));
  if (Deno.build.os === "windows") {
    log("  ⚠  `dune ps` needs `ps`/`lsof` and isn't supported on Windows yet.");
    return;
  }

  log("🏜️  Dune — scanning for running instances...\n");
  let all: DuneInstance[];
  try {
    all = await (deps.find ?? (() => findDuneInstances({ onWarning: (m) => log(`  ⚠  ${m}`) })))();
  } catch (err) {
    if (err instanceof MissingPermissionError) {
      log(`  ${err.message}`);
      Deno.exitCode = 1;
      return;
    }
    throw err;
  }

  if (all.length === 0) {
    log("  No dune dev/serve instances found running locally.");
    return;
  }

  for (const inst of all) for (const line of formatInstance(inst)) log(line);

  const serving = all.filter((i) => i.portStatus === "listening").length;
  const idle = all.filter((i) => i.portStatus === "not-listening").length;
  log(`  ${all.length} instance${all.length === 1 ? "" : "s"}: ${serving} listening, ${idle} not listening\n`);
  if (idle > 0) {
    log("  `dune stop --idle` stops only the not-listening ones; `dune stop <pid>` stops one instance.");
  }
}
