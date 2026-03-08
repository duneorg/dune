/**
 * Hook system types — lifecycle events and plugin definitions.
 */

import type { DuneConfig } from "../config/types.ts";
import type { StorageAdapter } from "../storage/types.ts";
import type { BlueprintField } from "../blueprints/types.ts";

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
  | "onApiResponse"

  // Engine lifecycle
  | "onRebuild"      // fired at the end of a successful engine.rebuild()
  | "onThemeSwitch"; // fired when the active theme changes

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

/**
 * API surface passed to a plugin's setup() function.
 * Gives plugins access to infrastructure without exposing full internals.
 */
export interface PluginApi {
  /** Hook registry — call hooks.on() to subscribe to lifecycle events */
  hooks: HookRegistry;
  /** Merged site configuration (read-only) */
  config: DuneConfig;
  /** Storage adapter for reading/writing plugin-specific data */
  storage: StorageAdapter;
}

/** Plugin definition */
export interface DunePlugin {
  /** Unique plugin identifier — used as the key in config.plugins */
  name: string;
  /** SemVer plugin version */
  version: string;
  /** Human-readable description shown in the admin panel */
  description?: string;
  /** Plugin author — shown in admin panel */
  author?: string;
  /**
   * Lifecycle hook subscriptions.
   * The registry calls these in registration order for each event.
   */
  hooks: Partial<Record<HookEvent, HookHandler>>;
  /**
   * Blueprint-style config schema.
   * When set, the admin panel renders a typed form for this plugin's config.
   * Config is persisted to data/plugins/{name}.json and merged into
   * config.plugins[name] at startup.
   */
  configSchema?: Record<string, BlueprintField>;
  /**
   * Optional setup function called once when the plugin is registered.
   * Use this for one-time initialization (e.g. registering extra hooks,
   * validating config, seeding data).
   */
  setup?: (api: PluginApi) => Promise<void> | void;
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
