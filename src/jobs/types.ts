/**
 * Background jobs — shared types.
 */

import type { DuneConfig } from "../config/types.ts";
import type { StorageAdapter } from "../storage/types.ts";
import type { DuneEngine } from "../core/engine.ts";

/** Structured logger available inside job handlers. */
export interface JobLogger {
  info(event: string, data?: Record<string, unknown>): void;
  warn(event: string, data?: Record<string, unknown>): void;
  error(event: string, data?: Record<string, unknown>): void;
}

/** Context injected into every job handler. Same surface as plugin hook context. */
export interface JobContext {
  /** Query the content index. */
  content: DuneEngine;
  /** Read site.yaml config values. */
  config: DuneConfig;
  /** Raw storage adapter for plugin-specific reads/writes. */
  storage: StorageAdapter;
  /** Structured logger. Entries include job name for filtering. */
  logger: JobLogger;
}

/** A validated, registered job definition loaded from jobs/*.ts. */
export interface JobDefinition {
  /** Filename stem (e.g. "weekly-digest" from jobs/weekly-digest.ts). */
  name: string;
  /** Standard 5-field cron expression. */
  schedule: string;
  /** The handler function exported as default from the job file. */
  handler: (ctx: JobContext) => Promise<void> | void;
}

/** Persisted per-job execution state. Stored in {runtimeDir}/jobs/{name}.json. */
export interface JobState {
  name: string;
  /** Timestamp (ms) of most recent execution start, or null if never run. */
  lastRun: number | null;
  /** Best-estimate timestamp (ms) of next scheduled run, or null if unknown. */
  nextRun: number | null;
  /** Current lifecycle state. */
  status: "idle" | "running" | "errored";
  /** Error message from the most recent failed run, or null. */
  lastError: string | null;
}
