/**
 * Hook system types — lifecycle events and plugin definitions.
 */

import type { DuneConfig } from "../config/types.ts";
import type { StorageAdapter } from "../storage/types.ts";
import type { BlueprintField } from "../blueprints/types.ts";
import type { FreshContext } from "fresh";

/**
 * All lifecycle events a plugin can subscribe to.
 *
 * **Stability:** frozen since v0.6.0. New events may be added in minor
 * versions; existing events will not be removed or renamed before v2.0.
 *
 * @since 0.1.0
 */
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
  | "onThemeSwitch"  // fired when the active theme changes

  // Content mutation (fired by admin CRUD operations)
  | "onPageCreate"       // page file created via admin panel
  | "onPageUpdate"       // page file updated via admin panel
  | "onPageDelete"       // page file deleted via admin panel
  | "onWorkflowChange";  // page workflow status changed

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

/**
 * Plugin definition.
 *
 * Implement this interface and export it as the default export of your plugin
 * module. Dune loads it automatically when the module is listed in
 * `site.yaml` under `plugins:`.
 *
 * **Stability:** frozen since v0.6.0.
 *
 * @since 0.1.0
 *
 * @example
 * ```ts
 * import type { DunePlugin } from "@dune/core";
 *
 * const plugin: DunePlugin = {
 *   name: "my-plugin",
 *   version: "1.0.0",
 *   hooks: {
 *     onPageLoaded: ({ data }) => {
 *       console.log("loaded:", data.route);
 *     },
 *   },
 * };
 *
 * export default plugin;
 * ```
 */

/**
 * A public-facing route contributed by a plugin.
 *
 * Plugins register these via `DunePlugin.publicRoutes`. The bootstrap process
 * collects them and wires them as programmatic Fresh routes before the content
 * catch-all handler. Unlike `onRequest`, these are proper Fresh routes with
 * access to `ctx.render()`, islands, and middleware.
 *
 * @since 1.1.0
 */
export interface PublicRouteRegistration {
  /**
   * HTTP method for this route (default: "GET").
   * Use "ALL" to match any method.
   */
  method?: "GET" | "POST" | "PUT" | "DELETE" | "ALL";
  /**
   * Full URL path (must start with `/`).
   * Example: `/newsletter/confirm`
   */
  path: string;
  /** Fresh handler for this route. */
  // deno-lint-ignore no-explicit-any
  handler: (ctx: FreshContext<any>) => Response | Promise<Response>;
  /**
   * Absolute path to an island module used by this route.
   * Included in the Builder's island scan so it's compiled into the bundle.
   * Example: `new URL("./islands/ConfirmPage.tsx", import.meta.url).pathname`
   */
  island?: string;
}

/**
 * A custom admin page contributed by a plugin.
 *
 * Plugins register these via `DunePlugin.adminPages`. The bootstrap process
 * collects them and wires them as programmatic Fresh routes after the core
 * admin file-system routes are mounted.
 *
 * @since 0.7.0
 */
// deno-lint-ignore no-explicit-any
export interface AdminPageRegistration<S = any> {
  /**
   * URL path relative to the admin prefix (must start with `/`).
   * Example: `/my-plugin` registers at `/admin/my-plugin`.
   */
  path: string;
  /** Human-readable nav label shown in the admin sidebar */
  label: string;
  /** Optional icon — emoji or inline SVG */
  icon?: string;
  /**
   * Admin permission required to view this page.
   * If omitted, any authenticated admin user can access the page.
   */
  permission?: string;
  /** Fresh GET handler for the page. */
  handler: (ctx: FreshContext<S>) => Promise<Response> | Response;
}

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
  /**
   * Absolute path to the plugin's static assets directory (assets/).
   * Set automatically by the plugin loader for local plugins that have an
   * assets/ subdirectory. Assets are served at /plugins/{name}/*.
   */
  assetDir?: string;
  /**
   * Absolute path to the plugin's templates directory (templates/).
   * Set automatically by the plugin loader for local plugins that have a
   * templates/ subdirectory. Templates are used as fallbacks after the
   * active theme chain is exhausted.
   */
  templateDir?: string;
  /**
   * Names of other plugins this plugin depends on.
   * The loader emits a warning (non-fatal) if any dependency is not installed.
   */
  dependencies?: string[];
  /**
   * Custom pages to add to the admin panel.
   *
   * Each entry registers a programmatic route under the admin prefix and
   * adds an optional sidebar link. The handler receives a Fresh context
   * with `AdminState` set by the admin middleware.
   *
   * Use this instead of file-system routes — core admin uses fsRoutes();
   * plugins extend it programmatically via these registrations.
   *
   * @since 0.7.0
   *
   * @example
   * ```ts
   * adminPages: [{
   *   path: "/my-plugin",
   *   label: "My Plugin",
   *   icon: "🧩",
   *   permission: "config.read",
   *   handler: (ctx) => ctx.render(<MyPluginPage />),
   * }],
   * ```
   */
  adminPages?: AdminPageRegistration[];
  /**
   * Public-facing Fresh routes contributed by this plugin.
   *
   * Registered before Dune's content catch-all so they take priority.
   * Handlers receive a full Fresh context with `ctx.render()`, islands,
   * and middleware — no manual URL matching needed.
   *
   * @since 1.1.0
   *
   * @example
   * ```ts
   * publicRoutes: [{
   *   path: "/newsletter/confirm",
   *   handler: async (ctx) => {
   *     const token = ctx.url.searchParams.get("token");
   *     // ... verify token
   *     return ctx.render(<ConfirmPage />);
   *   },
   *   island: new URL("./islands/ConfirmPage.tsx", import.meta.url).pathname,
   * }],
   * ```
   */
  publicRoutes?: PublicRouteRegistration[];
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
