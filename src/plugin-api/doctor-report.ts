/**
 * What the booted site tells `dune doctor --boot` about its plugins.
 *
 * `dune doctor --boot` starts the site in a subprocess and cannot see inside
 * it. When `DUNE_DOCTOR_REPORT` names a file, the site writes this report there
 * once its capability slots are resolved: who provides what, whether a provider
 * failed, and how many scheduled actions are waiting. A structured file rather
 * than a log line, so it does not depend on the log level or format.
 *
 * @module
 */

import type { CapabilityConflict, CapabilityProvider } from "./capabilities.ts";

/** Environment variable naming the file `dune doctor --boot` reads the report from. */
export const DOCTOR_REPORT_ENV = "DUNE_DOCTOR_REPORT";

/** The report. */
export interface DoctorReport {
  /** Every capability slot and contribution point with a provider. */
  providers: CapabilityProvider[];
  /** Exclusive slots (`editor.session`) that more than one plugin provided; the site did not finish booting. */
  conflicts?: CapabilityConflict[];
  /** Scheduled actions waiting to run (they only run while a `scheduler.executor` is provided). */
  scheduledActions: number;
  /** Where the config hands out admin-tier roles automatically (a payment product's role, an identity provider's role claims). */
  automaticGrants?: Array<{ severity: "info" | "warning"; message: string }>;
}

/**
 * Write the report when a doctor run asked for one. Never throws: a diagnostic
 * must not stop a site from booting.
 */
export async function writeDoctorReport(build: () => Promise<DoctorReport>): Promise<void> {
  const path = Deno.env.get(DOCTOR_REPORT_ENV);
  if (!path) return;
  try {
    await Deno.writeTextFile(path, JSON.stringify(await build()));
  } catch {
    // The doctor reports a missing report itself.
  }
}
