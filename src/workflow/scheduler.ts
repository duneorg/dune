/**
 * Content scheduler — handles scheduled publish/unpublish/archive actions.
 *
 * Uses Deno.cron (if available) or a polling interval to check for
 * pending scheduled actions and execute them.
 */

import type { StorageAdapter } from "../storage/types.ts";
import type { ScheduledAction } from "./types.ts";

export interface SchedulerConfig {
  storage: StorageAdapter;
  /** Directory for scheduler data */
  dataDir: string;
  /** Check interval in seconds (default: 60) */
  interval?: number;
}

export interface Scheduler {
  /** Schedule a new action */
  schedule(action: Omit<ScheduledAction, "id" | "createdAt">): Promise<ScheduledAction>;
  /** Cancel a scheduled action */
  cancel(id: string): Promise<boolean>;
  /** List all pending actions */
  list(): Promise<ScheduledAction[]>;
  /** List actions for a specific page */
  listForPage(sourcePath: string): Promise<ScheduledAction[]>;
  /** Check and execute due actions (called by timer) */
  tick(onAction: (action: ScheduledAction) => Promise<void>): Promise<number>;
  /** Start the scheduler polling loop */
  start(onAction: (action: ScheduledAction) => Promise<void>): void;
  /** Stop the scheduler */
  stop(): void;
}

/**
 * Create a content scheduler.
 */
export function createScheduler(config: SchedulerConfig): Scheduler {
  const { storage, dataDir } = config;
  const interval = (config.interval ?? 60) * 1000;
  let timer: number | undefined;

  const actionsDir = `${dataDir}/scheduled`;

  return {
    async schedule(input): Promise<ScheduledAction> {
      const action: ScheduledAction = {
        id: crypto.randomUUID().slice(0, 12),
        sourcePath: input.sourcePath,
        action: input.action,
        scheduledAt: input.scheduledAt,
        createdAt: Date.now(),
        createdBy: input.createdBy,
      };

      const path = `${actionsDir}/${action.id}.json`;
      const data = new TextEncoder().encode(JSON.stringify(action, null, 2));
      await storage.write(path, data);

      return action;
    },

    async cancel(id: string): Promise<boolean> {
      const path = `${actionsDir}/${id}.json`;
      try {
        await storage.delete(path);
        return true;
      } catch {
        return false;
      }
    },

    async list(): Promise<ScheduledAction[]> {
      try {
        const entries = await storage.list(actionsDir);
        const actions: ScheduledAction[] = [];

        for (const entry of entries) {
          if (entry.name.endsWith(".json")) {
            try {
              const data = await storage.read(`${actionsDir}/${entry.name}`);
              const action = JSON.parse(new TextDecoder().decode(data));
              actions.push(action);
            } catch {
              // Skip invalid files
            }
          }
        }

        return actions.sort((a, b) => a.scheduledAt - b.scheduledAt);
      } catch {
        return [];
      }
    },

    async listForPage(sourcePath: string): Promise<ScheduledAction[]> {
      const all = await this.list();
      return all.filter((a) => a.sourcePath === sourcePath);
    },

    async tick(onAction): Promise<number> {
      const now = Date.now();
      const actions = await this.list();
      let executed = 0;

      for (const action of actions) {
        if (action.scheduledAt <= now) {
          try {
            await onAction(action);
            await this.cancel(action.id);
            executed++;
          } catch (err) {
            console.error(`Scheduler: failed to execute ${action.id}: ${err}`);
          }
        }
      }

      return executed;
    },

    start(onAction): void {
      this.stop();
      timer = setInterval(() => {
        this.tick(onAction).catch(console.error);
      }, interval);
    },

    stop(): void {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    },
  };
}
