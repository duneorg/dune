/**
 * Dune background jobs — public API.
 *
 * @module
 */

export type {
  /** Context injected into every job handler. Same surface as plugin hook context. */
  JobContext,
  /** A validated, registered job definition loaded from jobs/*.ts. */
  JobDefinition,
  /** Persisted per-job execution state. Stored in {runtimeDir}/jobs/{name}.json. */
  JobState,
  JobLogger,
} from "./types.ts";
export { JobScheduler, warnIfMultiprocess } from "./scheduler.ts";
export { scanJobs } from "./scanner.ts";
export { matchesCron, nextRunAfter } from "./cron.ts";
