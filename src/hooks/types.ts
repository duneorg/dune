/**
 * Hook system types — lifecycle events and plugin definitions.
 */

import type { DuneConfig } from "../config/types.ts";
import type { StorageAdapter } from "../storage/types.ts";
import type { BlueprintField } from "../blueprints/types.ts";
import type { FreshContext } from "fresh";
import type { InlineEditManager } from "../inline-edit/types.ts";
import type { HistoryEngine } from "../history/engine.ts";

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
  /**
   * Background job API — only present when the job scheduler is running.
   * Allows hooks to trigger a registered job immediately regardless of its schedule.
   *
   * @example
   * ```ts
   * hooks.on("onPageCreate", async (ctx) => {
   *   await ctx.jobs?.run("reindex-search");
   * });
   * ```
   */
  jobs?: {
    /** Trigger a registered job by name immediately, regardless of its schedule. */
    run(name: string): Promise<void>;
  };
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

/**
 * Plugin definition interface.
 *
 * A Dune plugin is a plain object (or the return value of a factory function)
 * that registers hook handlers and optionally contributes admin pages, schemas,
 * and static assets.
 *
 * @example
 * ```ts
 * export default {
 *   name: "my-plugin",
 *   version: "1.0.0",
 *   hooks: {
 *     onRebuild: async (ctx) => { console.log("rebuilt"); },
 *   },
 * } satisfies DunePlugin;
 * ```
 */
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
  /**
   * Factory for admin-context services contributed by this plugin.
   *
   * Called during bootstrap after core infrastructure (storage, history) is
   * initialised but before the admin panel routes are mounted. Returning an
   * `inlineEdit` manager here is how plugins replace (or add to) the built-in
   * inline editing service.
   *
   * @since 0.17.0
   *
   * @example
   * ```ts
   * adminServices({ storage, history, dataDir, contentDir }) {
   *   return { inlineEdit: createMyEditManager({ storage, history, dataDir, contentDir }) };
   * }
   * ```
   */
  adminServices?: (ctx: AdminServicesContext) => Promise<AdminServices> | AdminServices;
  /**
   * Transform an HTTP response before it is sent to the client.
   *
   * Called for every response produced by the site (content pages, not admin
   * routes). Core pre-resolves auth and the matching content page, so the
   * plugin does not need to re-authenticate. Return a new `Response` to
   * replace the current one, or return `ctx.response` unchanged to pass through.
   *
   * Plugins are called in registration order. Each plugin receives the
   * response returned by the previous one, so transforms compose cleanly.
   *
   * Common uses: inject HTML fragments (admin bar, analytics snippet, A/B
   * testing markers), add custom headers, modify body content.
   *
   * @since 0.17.0
   *
   * @example
   * ```ts
   * transformResponse({ response, auth, page }) {
   *   if (!auth || !page) return response;
   *   const ct = response.headers.get("Content-Type") ?? "";
   *   if (!ct.includes("text/html")) return response;
   *   return injectHtml(response, myFragment);
   * }
   * ```
   */
  transformResponse?: (ctx: ResponseTransformContext) => Promise<Response> | Response;
}

/**
 * Context passed to {@link DunePlugin.adminServices} factories.
 *
 * Provides the infrastructure services a plugin needs to construct
 * admin-panel service objects (e.g. inline editing managers).
 *
 * @since 0.17.0
 */
export interface AdminServicesContext {
  /** Storage adapter for the site (reads/writes content and data files). */
  storage: StorageAdapter;
  /** Merged site configuration. */
  config: DuneConfig;
  /** Absolute data directory path (e.g. ".dune/data"). */
  dataDir: string;
  /** Content directory path relative to site root (e.g. "content"). */
  contentDir: string;
  /** History engine for recording content revisions. */
  history: HistoryEngine;
}

/**
 * Admin-panel services contributed by a plugin via {@link DunePlugin.adminServices}.
 *
 * @since 0.17.0
 */
export interface AdminServices {
  /** Inline editing manager (Y.js-backed real-time editor, v0.16+). */
  inlineEdit?: InlineEditManager;
}

/**
 * Context passed to {@link DunePlugin.transformResponse}.
 *
 * Auth is pre-resolved by core before calling plugins — no additional session
 * lookup is needed. `page` is the content page matching the current URL, or
 * null for non-content routes (admin paths, API paths, theme static assets).
 *
 * @since 0.17.0
 */
export interface ResponseTransformContext {
  /** The incoming HTTP request. */
  req: Request;
  /** The response produced by the app — possibly already transformed by earlier plugins. */
  response: Response;
  /**
   * Authenticated admin user, or null if the request carries no valid admin
   * session or the session lacks the minimum `pages.update` permission.
   */
  auth: {
    username: string;
    role: string;
    /** Check whether this user has a specific admin permission. */
    hasPermission(permission: string): boolean;
  } | null;
  /** Merged site configuration. */
  config: DuneConfig;
  /**
   * Content page matching the current URL, or null for non-content routes
   * (admin paths, API paths, plugin routes, theme static assets, etc.).
   */
  page: { sourcePath: string; route: string; title: string | null } | null;
  /** Admin panel URL prefix (e.g. `"/admin"`). */
  adminPrefix: string;
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
  /**
   * Inject a job runner into the hook context so handlers can call ctx.jobs.run().
   * Called by serve.ts after the job scheduler is started.
   */
  setJobContext(jobs: Required<HookContext>["jobs"]): void;
}
