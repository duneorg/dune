/**
 * Hook system types — lifecycle events and plugin definitions.
 */

import type { DuneConfig } from "../config/types.ts";
import type { StorageAdapter } from "../storage/types.ts";

/** All lifecycle events a plugin can subscribe to */
export type HookEvent =
  // Startup
  | "onConfigLoaded"
  | "onStorageReady"
  | "onContentIndexReady"

  // Request lifecycle
  | "onRequest"
  | "onRouteResolved"
  | "onPageLoaded"
  | "onCollectionResolved"
  | "onBeforeRender"
  | "onAfterRender"
  | "onResponse"

  // Content processing
  | "onMarkdownProcess"
  | "onMarkdownProcessed"
  | "onMediaDiscovered"

  // Cache
  | "onCacheHit"
  | "onCacheMiss"
  | "onCacheInvalidate"

  // API
  | "onApiRequest"
  | "onApiResponse";

/** Hook handler signature */
export type HookHandler<T = unknown> = (context: HookContext<T>) => Promise<void> | void;

/** Context passed to each hook handler */
export interface HookContext<T = unknown> {
  event: HookEvent;
  data: T;
  config: DuneConfig;
  storage: StorageAdapter;
  /** Stop further hook processing for this event */
  stopPropagation: () => void;
  /** Replace the data being passed through the hook chain */
  setData: (data: T) => void;
}

/** Plugin definition */
export interface DunePlugin {
  name: string;
  version: string;
  hooks: Partial<Record<HookEvent, HookHandler>>;
  /** Optional: plugin config schema for validation */
  configSchema?: Record<string, unknown>;
}

/** Hook registry interface */
export interface HookRegistry {
  /** Register a plugin */
  registerPlugin(plugin: DunePlugin): void;
  /** Register a single hook handler */
  on<T = unknown>(event: HookEvent, handler: HookHandler<T>): void;
  /** Remove a hook handler */
  off(event: HookEvent, handler: HookHandler): void;
  /** Fire a hook event, passing data through all handlers */
  fire<T = unknown>(event: HookEvent, data: T): Promise<T>;
  /** List registered plugins */
  plugins(): DunePlugin[];
}
