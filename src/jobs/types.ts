/**
 * Background jobs — shared types.
 */

import type { DuneConfig } from "../config/types.ts";
import type { StorageAdapter } from "../storage/types.ts";
import type { DuneEngine } from "../core/engine.ts";
import type { ContentApi } from "../content/api.ts";

/** Structured logger available inside job handlers. */
export interface JobLogger {
  info(event: string, data?: Record<string, unknown>): void;
  warn(event: string, data?: Record<string, unknown>): void;
  error(event: string, data?: Record<string, unknown>): void;
}

/** Context injected into every job handler. Same surface as plugin hook context. */
export interface JobContext {
  /**
   * The raw content engine. `.pages` is a plain array property (not a
   * method), `.loadPage(sourcePath)` loads one full page. Kept as-is
   * (rather than replaced with `ContentApi`) so existing jobs relying on
   * this exact shape don't break — see `contentApi` below for the
   * friendlier `.pages()`/`.page()`/`.search()`/`.taxonomy()` surface.
   */
  content: DuneEngine;
  /**
   * The content query API (`.pages()`, `.page()`, `.search()`, `.taxonomy()`)
   * — the same instance `bootstrap()` returns as `contentApi`. Always
   * present; jobs only run after bootstrap has fully completed.
   *
   * @since 0.31.7
   */
  contentApi: ContentApi;
  /** Read site.yaml config values. */
  config: DuneConfig;
  /** Raw storage adapter for plugin-specific reads/writes. */
  storage: StorageAdapter;
  /** Structured logger. Entries include job name for filtering. */
  logger: JobLogger;
  /**
   * Transactional email client. Present when an email provider is configured
   * in site.yaml (email.provider). In dev mode, uses the console provider.
   * Guard with `ctx.config.site.email?.provider` before use if email may not
   * be configured.
   */
  email: import("../email/client.ts").EmailClient;
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
