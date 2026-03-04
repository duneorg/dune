/**
 * Hook system — plugin lifecycle events.
 */

export { createHookRegistry } from "./registry.ts";
export type {
  DunePlugin,
  HookContext,
  HookEvent,
  HookHandler,
  HookRegistry,
  PluginApi,
} from "./types.ts";
