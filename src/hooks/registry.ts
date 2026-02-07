/**
 * Hook registry — manages plugin lifecycle events.
 *
 * Hooks form a pipeline: each handler receives the data from the
 * previous handler (or the original data for the first handler).
 * Handlers can modify data via setData() or stop the chain via
 * stopPropagation().
 */

import type { DuneConfig } from "../config/types.ts";
import type { StorageAdapter } from "../storage/types.ts";
import type {
  DunePlugin,
  HookContext,
  HookEvent,
  HookHandler,
  HookRegistry,
} from "./types.ts";

export interface HookRegistryOptions {
  config: DuneConfig;
  storage: StorageAdapter;
}

/**
 * Create a hook registry for managing plugins and lifecycle events.
 */
export function createHookRegistry(options: HookRegistryOptions): HookRegistry {
  const { config, storage } = options;

  // Map of event → ordered list of handlers
  const handlers = new Map<HookEvent, HookHandler[]>();
  const registeredPlugins: DunePlugin[] = [];

  function getHandlers(event: HookEvent): HookHandler[] {
    if (!handlers.has(event)) {
      handlers.set(event, []);
    }
    return handlers.get(event)!;
  }

  return {
    registerPlugin(plugin: DunePlugin): void {
      registeredPlugins.push(plugin);

      // Register all hooks from the plugin
      for (const [event, handler] of Object.entries(plugin.hooks)) {
        if (handler) {
          getHandlers(event as HookEvent).push(handler);
        }
      }

      if (config.system.debug) {
        const hookCount = Object.keys(plugin.hooks).length;
        console.log(
          `[dune] Plugin "${plugin.name}" v${plugin.version} registered (${hookCount} hooks)`,
        );
      }
    },

    on<T = unknown>(event: HookEvent, handler: HookHandler<T>): void {
      getHandlers(event).push(handler as HookHandler);
    },

    off(event: HookEvent, handler: HookHandler): void {
      const list = handlers.get(event);
      if (!list) return;
      const idx = list.indexOf(handler);
      if (idx >= 0) list.splice(idx, 1);
    },

    async fire<T = unknown>(event: HookEvent, data: T): Promise<T> {
      const list = handlers.get(event);
      if (!list || list.length === 0) return data;

      let currentData = data;
      let stopped = false;

      for (const handler of list) {
        if (stopped) break;

        const ctx: HookContext<T> = {
          event,
          data: currentData,
          config,
          storage,
          stopPropagation: () => {
            stopped = true;
          },
          setData: (newData: T) => {
            currentData = newData;
          },
        };

        await (handler as HookHandler<T>)(ctx);
      }

      return currentData;
    },

    plugins(): DunePlugin[] {
      return [...registeredPlugins];
    },
  };
}
