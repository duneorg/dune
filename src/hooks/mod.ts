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
} from "./types.ts";
