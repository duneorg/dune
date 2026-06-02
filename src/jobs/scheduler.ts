/**
 * JobScheduler — minute-tick interval scheduler for background jobs.
 *
 * Fires registered jobs when the current wall-clock minute matches their
 * cron expression. State (lastRun, status, lastError) is persisted to
 * {stateDir}/{name}.json via the StorageAdapter.
 *
 * Error behaviour: log + persist lastError + continue scheduling. No retry.
 * Multi-process warning: emitted at startup when workers > 1.
 */

import { join } from "@std/path";
import { matchesCron, nextRunAfter } from "./cron.ts";
import type { JobContext, JobDefinition, JobState } from "./types.ts";
import type { StorageAdapter } from "../storage/types.ts";

const TICK_INTERVAL_MS = 60_000; // 1 minute

export interface JobSchedulerConfig {
  definitions: JobDefinition[];
  context: JobContext;
  /** Directory for persisting per-job state JSON files. */
  stateDir: string;
  storage: StorageAdapter;
}

export class JobScheduler {
  private readonly definitions: Map<string, JobDefinition>;
  private readonly context: JobContext;
  private readonly stateDir: string;
  private readonly storage: StorageAdapter;
  private tickTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(config: JobSchedulerConfig) {
    this.definitions = new Map(config.definitions.map((d) => [d.name, d]));
    this.context = config.context;
    this.stateDir = config.stateDir;
    this.storage = config.storage;
  }

  /** Start the scheduler. Fires immediately if any job matches the current minute. */
  start(): void {
    if (this.stopped) return;
    this.scheduleTick();
  }

  /** Stop the scheduler cleanly. In-progress handlers are not interrupted. */
  stop(): void {
    this.stopped = true;
    if (this.tickTimer !== null) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }
  }

  /** Manually trigger a job by name regardless of schedule. */
  async run(name: string): Promise<void> {
    const def = this.definitions.get(name);
    if (!def) throw new Error(`Unknown job: "${name}"`);
    await this.executeJob(def);
  }

  /** Get the current state for all registered jobs. */
  async listStatus(): Promise<JobState[]> {
    const states: JobState[] = [];
    for (const def of this.definitions.values()) {
      states.push(await this.readState(def));
    }
    return states.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Get the current state for a single job. */
  async getStatus(name: string): Promise<JobState | null> {
    const def = this.definitions.get(name);
    if (!def) return null;
    return this.readState(def);
  }

  get jobNames(): string[] {
    return [...this.definitions.keys()].sort();
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private scheduleTick(): void {
    if (this.stopped) return;

    // Align to the top of the next minute for accuracy, with a small 1s buffer
    // to avoid missing the minute boundary due to timer drift.
    const now = Date.now();
    const msUntilNextMinute = TICK_INTERVAL_MS - (now % TICK_INTERVAL_MS) + 1000;
    const delay = Math.min(msUntilNextMinute, TICK_INTERVAL_MS);

    this.tickTimer = setTimeout(async () => {
      if (this.stopped) return;
      await this.tick();
      this.scheduleTick();
    }, delay);
  }

  private async tick(): Promise<void> {
    const now = new Date();
    for (const def of this.definitions.values()) {
      if (matchesCron(def.schedule, now)) {
        // Fire in background — do not await so one slow job doesn't block others
        this.executeJob(def).catch((err) => {
          console.error(`[dune/jobs] Unhandled error in ${def.name}:`, err);
        });
      }
    }
  }

  private async executeJob(def: JobDefinition): Promise<void> {
    const state = await this.readState(def);
    if (state.status === "running") {
      console.warn(`[dune/jobs] ${def.name} is already running — skipping this execution`);
      return;
    }

    const startedAt = Date.now();
    await this.writeState(def, {
      ...state,
      status: "running",
      lastRun: startedAt,
    });

    try {
      await def.handler(this.context);
      const next = nextRunAfter(def.schedule, new Date());
      await this.writeState(def, {
        name: def.name,
        lastRun: startedAt,
        nextRun: next?.getTime() ?? null,
        status: "idle",
        lastError: null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const next = nextRunAfter(def.schedule, new Date());
      await this.writeState(def, {
        name: def.name,
        lastRun: startedAt,
        nextRun: next?.getTime() ?? null,
        status: "errored",
        lastError: msg,
      });
      this.context.logger.error("jobs.handler_failed", { job: def.name, error: msg });
    }
  }

  private statePath(name: string): string {
    return `${this.stateDir}/${name}.json`;
  }

  private async readState(def: JobDefinition): Promise<JobState> {
    try {
      if (await this.storage.exists(this.statePath(def.name))) {
        const raw = await this.storage.read(this.statePath(def.name));
        return JSON.parse(new TextDecoder().decode(raw)) as JobState;
      }
    } catch { /* fall through */ }
    // No persisted state yet — compute nextRun from schedule
    const next = nextRunAfter(def.schedule, new Date());
    return {
      name: def.name,
      lastRun: null,
      nextRun: next?.getTime() ?? null,
      status: "idle",
      lastError: null,
    };
  }

  private async writeState(def: JobDefinition, state: JobState): Promise<void> {
    try {
      await this.storage.write(
        this.statePath(def.name),
        new TextEncoder().encode(JSON.stringify(state, null, 2)),
      );
    } catch (err) {
      console.warn(`[dune/jobs] Failed to persist state for ${def.name}:`, err);
    }
  }
}

/**
 * Emit a startup warning when workers > 1 and jobs are defined.
 * Every process runs every job — duplicate execution is silent without this.
 */
export function warnIfMultiprocess(jobCount: number, workers: number): void {
  if (jobCount > 0 && workers > 1) {
    console.warn(
      `\n⚠  Background jobs are defined but workers > 1. Every worker process will\n` +
        `   run every job — this causes duplicate execution. Use a single worker\n` +
        `   process or move to a queue-backed job runner (see docs/deployment/jobs).\n`,
    );
  }
}
