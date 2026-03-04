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
  PluginApi,
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

  // Capture self-reference so setup() can receive the registry as PluginApi.hooks.
  // The variable is assigned immediately after the object literal is created.
  let self: HookRegistry;

  const registry: HookRegistry = {
    registerPlugin(plugin: DunePlugin): void {
      registeredPlugins.push(plugin);

      // Register all hooks from the plugin
      for (const [event, handler] of Object.entries(plugin.hooks)) {
        if (handler) {
          getHandlers(event as HookEvent).push(handler);
        }
      }

      // Call the plugin's setup function if defined, giving it access to the
      // registry, config, and storage — but NOT the full engine (not yet ready).
      if (plugin.setup) {
        const api: PluginApi = { hooks: self, config, storage };
        // setup() may return a Promise — fire-and-forget is intentional here;
        // async setup tasks should subscribe to onContentIndexReady instead.
        const maybePromise = plugin.setup(api);
        if (maybePromise instanceof Promise) {
          maybePromise.catch((err) => {
            console.error(`[dune] Plugin "${plugin.name}" setup() failed: ${err}`);
          });
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

  self = registry;
  return registry;
}
