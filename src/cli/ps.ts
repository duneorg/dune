/**
 * dune ps — list dune dev/serve instances currently running on this machine.
 *
 * Read-only: it never prompts and never signals anything. Stopping what it
 * lists is `dune stop` (stop.ts). Discovery lives in instances.ts.
 *
 * @module
 */

import { type DuneInstance, findDuneInstances } from "./instances.ts";

/** Injection points so the command's output is testable without touching real processes. */
export interface PsDeps {
  find?: () => Promise<DuneInstance[]>;
  log?: (line: string) => void;
}

export function describePort(inst: DuneInstance): string {
  if (inst.portStatus === "listening") {
    const urls = inst.ports.map((p) => `http://localhost:${p}`).join(", ");
    return inst.responsive === "not-responding"
      ? `${urls} — NOT RESPONDING (no answer to a health check; the server may be hung)`
      : urls;
  }
  if (inst.portStatus === "not-listening") return "not listening (no open port; likely a hung or leftover process)";
  return "port unknown (lsof not available)";
}

/** The lines `dune ps` prints for one instance (shared with `dune stop`, which shows what it is about to stop). */
export function formatInstance(inst: DuneInstance): string[] {
  const extra = inst.pids.length > 1
    ? `  (+${inst.pids.length - 1} child process${inst.pids.length > 2 ? "es" : ""})`
    : "";
  return [
    `  PID ${inst.pid}  ${inst.mode.padEnd(5)}  up ${inst.elapsed ?? "?"}${inst.version ? `  v${inst.version}` : ""}${extra}`,
    `    ${inst.title ?? "(untitled)"}`,
    `    ${inst.root ?? "(site root unconfirmed — no config/site.yaml via --root, PWD or live cwd)"}`,
    `    ${describePort(inst)}`,
    `    $ ${inst.command.length > 110 ? inst.command.slice(0, 107) + "..." : inst.command}\n`,
  ];
}

export async function psCommand(deps: PsDeps = {}): Promise<void> {
  const log = deps.log ?? ((l: string) => console.log(l));
  if (Deno.build.os === "windows") {
    log("  ⚠  `dune ps` needs `ps`/`lsof` and isn't supported on Windows yet.");
    return;
  }

  log("🏜️  Dune — scanning for running instances...\n");
  const all = await (deps.find ?? findDuneInstances)();

  if (all.length === 0) {
    log("  No dune dev/serve instances found running locally.");
    return;
  }

  for (const inst of all) for (const line of formatInstance(inst)) log(line);

  const serving = all.filter((i) => i.portStatus === "listening").length;
  const stuck = all.filter((i) => i.responsive === "not-responding").length;
  const notListening = all.filter((i) => i.portStatus === "not-listening").length;
  log(
    `  ${all.length} instance${all.length === 1 ? "" : "s"}: ${serving} listening` +
      `${stuck > 0 ? ` (${stuck} not responding)` : ""}, ${notListening} not listening\n`,
  );
  if (stuck + notListening > 0) {
    log("  `dune stop --idle` stops only the ones that aren't serving (not listening or not responding); `dune stop <pid>` stops one instance.");
  }
}
