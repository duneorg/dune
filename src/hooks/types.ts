/**
 * Hook system types — lifecycle events and plugin definitions.
 *
 * @module
 */

import type { DuneConfig } from "../config/types.ts";
import type { StorageAdapter } from "../storage/types.ts";
import type { BlueprintField } from "../blueprints/types.ts";
import type { FreshContext } from "fresh";
import type { ContentApi } from "../content/api.ts";
import type { AuthzRelation } from "../auth/authz-schema.ts";

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
  | "onCollectionResolved"
  | "onBeforeRender"
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
  | "onRebuild" // fired at the end of a successful engine.rebuild()
  | "onThemeSwitch" // fired when the active theme changes
  // Search
  | "onSearchRecordsCollect" // collect plugin-injected records before indexing
  | "onSearchEngineCreate" // let a plugin provide an alternative search engine
  // Content mutation: fired by whoever writes the page (an admin, the MCP
  // server, a CLI command, a plugin), never by core on their behalf. Payloads
  // carry paths relative to the content directory. Edits made outside Dune
  // (an editor, git pull) fire nothing per page: they surface as onRebuild.
  | "onPageCreate" // a page file was created: { sourcePath, title }
  | "onPageUpdate" // a page file was written: { sourcePath }
  | "onPageDelete" // a page file was deleted: { sourcePath }
  | "onPageMove" // pages were renamed or reordered: PageMovePayload
  | "onWorkflowChange" // page workflow status changed: { sourcePath, from, to }
  // Public features (fired by core, so they work without an admin plugin)
  | "onFormSubmit" // a form submission was accepted and stored
  | "onSystemAction"; // an incoming webhook triggered rebuild / purge-cache

/**
 * Payload of `onPageMove`: pages were renamed, renumbered or reordered.
 *
 * Each entry names what was renamed on disk, a page folder or a single page
 * file, as paths relative to the content directory. Every page at or below
 * `from` now lives at the same position below `to`. One event covers one
 * operation (a reorder renames many folders), so a handler can re-index once.
 */
export interface PageMovePayload {
  moves: Array<{ from: string; to: string }>;
}

/**
 * Payload of `onFormSubmit`: a public form submission was accepted and stored.
 * Spam (honeypot) and invalid submissions never fire it.
 *
 * @since 0.35.2
 */
export interface FormSubmitPayload {
  /** Form name (the `forms/<name>.yaml` file). */
  form: string;
  /** The stored submission, including `id`, `fields`, `meta` and any `files`. */
  submission: import("../forms/submissions.ts").Submission;
}

/**
 * Payload of `onSystemAction`: an incoming webhook (`POST /api/webhook/incoming`)
 * ran an action. Fired once per action. Use it to audit or mirror the action.
 *
 * @since 0.35.2
 */
export interface SystemActionPayload {
  action: "rebuild" | "purge-cache";
  /** Source IP (honours `system.trusted_proxies`), or null when unknown. */
  ip: string | null;
  userAgent: string | null;
}

/** Hook handler signature */
export type HookHandler<T = unknown> = (
  context: HookContext<T>,
) => Promise<void> | void;

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
  /**
   * The content query API (`.pages()`, `.page()`, `.search()`, `.taxonomy()`)
   * — only present once whoever created this `HookRegistry` has called
   * `setContentApi()` on it. `bootstrap()`'s own registry gets this called
   * right after it builds the `ContentApi`, so it's `undefined` only for
   * the handful of hooks that fire earlier in the bootstrap sequence, before
   * there's a content index to query yet: `onConfigLoaded`,
   * `onStorageReady`, `onContentIndexReady`, `onSearchRecordsCollect`, and
   * `onSearchEngineCreate`. Present for every other live hook
   * (`onPageCreate`/`onPageUpdate`/`onPageDelete`/`onPageMove`/`onWorkflowChange`,
   * `onRequest`, `onCacheInvalidate`, `onRebuild`, `onThemeSwitch`), all of
   * which fire after bootstrap completes — **except** on the lightweight,
   * standalone `HookRegistry` some CLI commands build without a full
   * `bootstrap()` (`content:create`'s `onPageCreate`, `migrate:*`'s
   * `onPageCreate` with `--fire-hooks`), which never call `setContentApi()`
   * at all, so `ctx.content` is `undefined` there regardless of which event
   * fired. `content:delete`'s `onPageDelete` is not in that group — it runs
   * through a real `bootstrap()`, so `ctx.content` is populated there like
   * any other post-bootstrap hook. Guard with `ctx.content?.` unless you've
   * confirmed your handler only ever runs through the full bootstrap path.
   *
   * @since 0.31.7
   */
  content?: ContentApi;
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
  /**
   * Services built by core: security policy, sessions, users, passwords,
   * rate limiting, logger. Reach policy through these instead of importing it
   * from `@dune/core`, so the plugin always runs against the running core's
   * policy. See `@dune/core/plugin-api`.
   */
  services: import("../plugin-api/services.ts").PluginServices;
  /**
   * Declare what this plugin provides to core and to other plugins: slots
   * (`provide`) and contributions (`contribute`). Declaring only records it;
   * core resolves the slot factories after every `setup()` has settled.
   * See `@dune/core/plugin-api`.
   */
  capabilities: import("../plugin-api/capabilities.ts").CapabilityRegistrar;
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
 *     onPageCreate: ({ data }) => {
 *       console.log("created:", data.sourcePath);
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
 * Plugins register these via `DunePlugin.publicRoutes`. `bootstrap()` collects
 * them onto `BootstrapResult.pluginPublicRoutes`, and `createDuneApp()` wires
 * them as programmatic Fresh routes before the content catch-all handler —
 * this happens in `@dune/core` itself (`registerPluginPublicRoutes()`), so it
 * works in every `createDuneApp()` context (headless, `admin.enabled: false`,
 * etc.), not only when an admin package's `mount()` happens to run. Unlike
 * `onRequest`, these are proper Fresh routes with access to `ctx.render()`,
 * islands, and middleware.
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
 * Context passed to a `bar.actions` contribution.
 *
 * Deliberately the same narrowed shape {@link ResponseTransformContext}
 * passes as `page`/`adminPrefix` (plus `template`, which actions need to
 * decide what to show but `transformResponse` itself has never needed) —
 * a plugin contributing bar actions is answering "what belongs on the bar
 * for this response," the same question `transformResponse` answers for
 * the page body.
 *
 * @since 1.2.0
 */
export interface AdminBarActionContext {
  /** Content page matching the current URL, or null for non-content routes. */
  page: { sourcePath: string; route: string; title: string | null; template: string } | null;
  /** Admin panel URL prefix (e.g. `"/admin"`). */
  adminPrefix: string;
}

/**
 * A button contributed to the shared admin bar UI through the `bar.actions`
 * contribution point. Rendered by whichever plugin owns the
 * bar (e.g. `@dune/plugin-inline-edit`) — the contributing plugin controls
 * only the button's appearance and behavior, not its position or styling.
 *
 * @since 1.2.0
 */
export interface AdminBarAction {
  /**
   * Unique id — namespace by plugin name to avoid collisions across
   * plugins, e.g. `"pdf-export:download"`.
   */
  id: string;
  /** Button label. */
  label: string;
  /** Optional emoji/icon prefix. */
  icon?: string;
  /**
   * Renders as a plain link (`<a href>`) when set — the common case for
   * downloads and navigation. Mutually exclusive with `onClick`; `href`
   * takes precedence if both are set.
   */
  href?: string;
  /**
   * Renders as a `<button>` running this literal JavaScript on click, when
   * `href` is not set. Trusted content from a loaded plugin, not user
   * input — no sanitization is applied, the same trust level as any other
   * server-rendered admin-only script.
   */
  onClick?: string;
}

/**
 * A custom admin page contributed by a plugin.
 *
 * Plugins contribute these to the `admin.pages` point:
 * `api.capabilities.contribute("admin.pages", { path, label, permission, handler })`.
 * Unlike `publicRoutes`, this is **not** wired by `@dune/core` itself: whichever
 * admin package provides the admin UI reads the list (`capabilities.list("admin.pages")`)
 * and mounts each page as a programmatic route, enforcing its declared
 * `permission`. A site without an admin package gets no admin pages; there is
 * no core fallback, because enforcing `permission` needs an admin-specific
 * auth system that `@dune/core` has no reason to depend on.
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
   * Admin permission required to view this page. Required, like
   * {@link AdminRouteRegistration.permission}: every admin contribution says
   * who may use it, so a page cannot be exposed to every authenticated admin
   * by leaving a field out.
   */
  permission: string;
  /** Fresh GET handler for the page. */
  handler: (ctx: FreshContext<S>) => Promise<Response> | Response;
}

/**
 * A guarded admin route contributed by a plugin: the way to add a `POST`, `PUT`,
 * `PATCH` or `DELETE` endpoint (or a `GET` API route that is not a sidebar page)
 * under the admin prefix.
 *
 * Plugins contribute these to the `admin.routes` point:
 * `api.capabilities.contribute("admin.routes", { method, path, permission, handler })`.
 * Whichever admin package provides the admin UI reads the list
 * (`capabilities.list("admin.routes")`) and mounts each route behind its own
 * authentication, with the CSRF check applied to every non-safe method and the
 * declared `permission` enforced, so the handler only runs for a request that
 * passed all three. A site without an admin package mounts nothing.
 *
 * A route registered directly in a plugin's `mount()` is *not* behind the
 * admin's middleware (mount order is registration order, and the admin mounts
 * last), so it cannot use the admin's guards: contribute it here instead.
 *
 * @since 0.36.0
 */
// deno-lint-ignore no-explicit-any
export interface AdminRouteRegistration<S = any> {
  /** HTTP method. Anything other than `GET` is subject to the CSRF check. */
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /**
   * URL path relative to the admin prefix (must start with `/`).
   * Example: `/my-plugin/save` registers at `/admin/my-plugin/save`.
   */
  path: string;
  /**
   * Admin permission required (including ones the plugin declares through
   * `authzActions`). Required, not optional: a mutation endpoint must say who
   * may call it, so it cannot be mounted open to every authenticated admin by
   * leaving a field out.
   */
  permission: string;
  /** Fresh handler; runs only after authentication, CSRF and permission checks pass. */
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
   * Browser code entry points to bundle and serve.
   *
   * Each entry maps a name to a module specifier (use
   * `import.meta.resolve("./client/editor.ts")` so it works both for local
   * and JSR-hosted plugins). At startup Dune bundles each entry for the
   * browser (`deno bundle --platform browser`, resolving the plugin's own
   * npm/jsr dependencies) and serves the result at
   * `/plugins/{plugin-name}/{entry}.js`.
   *
   * Bundles are cached in `.dune/client-bundles/` keyed by plugin
   * name+version, so a published plugin is bundled once per version.
   * Bump the plugin version whenever client code changes.
   *
   * ## Production bundling and the lock file
   *
   * A production cold start (empty bundle cache) bundles on the serving
   * host with `--frozen`: resolution that would change the lock file fails
   * the entry (it logs and 404s; the app still starts). All of a plugin's
   * client dependencies must therefore be pinned in the site's lock file —
   * run the site once in dev after adding a plugin and commit the updated
   * lock. (`deno install` is NOT enough: plugins load from `site.yaml`, not
   * the site's import map, so their dependency graph only enters the lock
   * when the dev-mode bundle resolves it.) Cold starts may also need
   * registry access to
   * populate the module cache; pre-warm `.dune/client-bundles/` in your
   * deploy step if production hosts are network-restricted.
   *
   * Load lazily from injected scripts or islands:
   * ```js
   * const mod = await import("/plugins/my-plugin/editor.js");
   * ```
   *
   * @since 0.19.0
   */
  clientEntries?: Record<string, string>;
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
   * Preact island file specifiers contributed by this plugin.
   *
   * Absolute file paths or remote URLs (e.g. `jsr:@dune/plugin-admin/...`)
   * that Fresh should include in its island bundle. Plugins that ship islands
   * outside of `publicRoutes` entries (e.g. the admin panel) set this field
   * so core can collect them without importing the plugin package directly.
   *
   * Specifiers are passed through `materializeRemoteIslands()` before
   * reaching Fresh's Builder, so remote (https://) URLs are supported.
   *
   * @since 0.24.0
   */
  islandSpecifiers?: string[];
  /**
   * New admin-permission actions this plugin contributes to the polizy authz
   * schema, keyed by action name and mapping to the existing relations that
   * satisfy it — the same shape as `@dune/core`'s own built-in actions (see
   * `src/auth/authz-schema.ts`'s `DUNE_BASE_AUTHZ_ACTIONS`), just declared
   * by a plugin instead of core.
   *
   * Lets a plugin gate a genuinely new admin capability the correct way —
   * `authz.check()`, same as every built-in admin route — instead of either
   * reusing an existing, semantically-mismatched permission or hand-rolling
   * a check outside the authz system entirely. `bootstrap()` collects every
   * registered plugin's `authzActions` (after `setup()` has run, before the
   * site's authz system is created) and merges them into the schema; an
   * action name that collides with a built-in or another plugin's is
   * dropped with a logged warning, not silently merged — first declaration
   * wins in registration order.
   *
   * Relation-only, not a way to define a new relation *type*: values must
   * be drawn from `"member" | "admin" | "editor" | "author" | "owner"`, the
   * same structural vocabulary every built-in action already uses.
   *
   * @since 0.34.4
   *
   * @example
   * ```ts
   * // Gate a plugin-specific admin capability behind its own permission,
   * // reachable from an `admin.routes` contribution:
   * //   api.capabilities.contribute("admin.routes", { method: "POST", path: "/billing/refund", permission: "billing.manage", handler })
   * export default {
   *   name: "my-billing-plugin",
   *   version: "1.0.0",
   *   authzActions: {
   *     "billing.manage": ["admin"],
   *   },
   *   hooks: {},
   * } satisfies DunePlugin;
   * ```
   */
  authzActions?: Record<string, readonly AuthzRelation[]>;
  /**
   * Mount Fresh routes onto the app.
   *
   * Called by {@link mountPlugins} after `bootstrap()` completes and the Fresh
   * `App` instance is available, but before the app starts handling requests.
   * Use this to register routes, middleware, and layouts that require a `FreshContext`
   * (e.g. an admin panel sub-app, a dashboard, a set of auth routes).
   *
   * Capability slots (`auth.session`, `inline-edit`, ...) are resolved before
   * `mount()` runs and are read through `api.capabilities`, lazily (at request
   * time): do not assume a provider exists.
   *
   * Runs in plugin registration order, so a route registered here can rely on
   * every plugin registered *before* this one already having registered its
   * own `mount()`-time middleware and routes.
   *
   * @since 0.24.0
   *
   * @example
   * ```ts
   * import { registerAdminRoutes } from "./routes.ts";
   *
   * mount({ app, runtime, capabilities }) {
   *   registerAdminRoutes(app, runtime.config, capabilities);
   * }
   * ```
   */
  mount?: (api: MountApi) => Promise<void> | void;

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
   * Common uses: inject HTML fragments (admin bar, analytics snippet),
   * add custom headers, modify body content.
   *
   * ## Caching contract
   *
   * Transforms also run for **anonymous** requests (with `auth: null`), and
   * in production the transformed response is stored in the shared page
   * cache keyed by pathname only. Requests carrying an admin session cookie
   * always bypass that cache; nothing else does. Therefore transform output
   * **must depend only on `ctx.auth` and `ctx.page`** — never on other
   * request attributes such as non-admin cookies, headers, the query string,
   * or per-request randomness (e.g. A/B bucketing). Output that varies on
   * anything else would be cached under the bare pathname and served to
   * every visitor.
   *
   * The transform pipeline is part of the page ETag: each transform
   * plugin's `name@version` is folded into the hash, so installing,
   * removing, or upgrading a transform plugin invalidates page-cache
   * entries and browser-revalidated (304) copies. Output changes that are
   * not accompanied by a version bump (e.g. config-driven changes within
   * the same plugin version) are NOT detected — bump the plugin version
   * whenever the produced output changes.
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
  transformResponse?: (
    ctx: ResponseTransformContext,
  ) => Promise<Response> | Response;
}

/**
 * Plugin-provided replacement for the built-in block editor.
 *
 * Provide it as the `editor.content` capability: `api.capabilities.provide("editor.content", () => impl)`.
 * The edit route delegates to `pageEditorHandler` instead of the default block editor.
 *
 * Defined in core (not in `@dune/plugin-admin`) so that alternative editor plugins can
 * type their implementation without taking a dependency on the admin plugin itself.
 *
 * @since 0.24.0
 */
export interface ContentEditorPlugin {
  /**
   * Handle `GET /admin/pages/edit?path=...`.
   *
   * Receives the full Fresh context — call `ctx.render(component)` to render
   * within the admin layout, or return any `Response` directly.
   * Access `ctx.state.adminContext` for engine, config, and other admin services.
   * The context state type is `AdminState` from `@dune/plugin-admin`; typed as
   * `any` here so core does not depend on admin-internal types.
   */
  // deno-lint-ignore no-explicit-any
  pageEditorHandler(ctx: FreshContext<any>): Response | Promise<Response>;

  /**
   * Optional WebSocket upgrade handler for real-time collaboration.
   *
   * When present, `GET /admin/api/content-editor/ws?path=...` delegates here
   * after auth and path validation. Return a `101 Switching Protocols` response
   * via `Deno.upgradeWebSocket`. When absent the WS endpoint responds 501.
   */
  wsHandler?: (
    req: Request,
    user: { id: string; name: string },
  ) => Response;
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
    /**
     * Check whether this user has a specific admin permission. `auth` being
     * non-null already means the session holds `pages.update`, checked via
     * `authz.check()` — the sole authority (dec-identity-unification Phase
     * 5c/7). This method itself stays synchronous (a published hook API)
     * and so cannot re-consult `authz.check()` per call; it answers from
     * `roleHasPermission()` (`@dune/core/auth/authz-schema`), a synchronous
     * role-only read of the same canonical `actionToRelations` schema
     * `authz.check()` itself uses — exact for `pages.update` (already gated
     * above) and a reasonable approximation for any other permission a
     * plugin might ask about.
     *
     * ⚠️ Trust accordingly: this is a role-only *approximation*, not the
     * authority. It ignores everything `authz.check()` knows beyond roles
     * (revoked tuples, per-user direct grants, group membership), so its
     * answer can diverge from a real `authz.check()` in either direction.
     * Fine for UI affordances and informational gating inside a plugin;
     * do not treat it as an access-control decision for anything sensitive.
     */
    hasPermission(permission: string): boolean;
  } | null;
  /** Merged site configuration. */
  config: DuneConfig;
  /**
   * Content page matching the current URL, or null for non-content routes
   * (admin paths, API paths, plugin routes, theme static assets, etc.).
   * `template` was added in 1.2.0 alongside the bar actions — existing
   * consumers destructuring the other four fields are unaffected.
   */
  page: { sourcePath: string; route: string; title: string | null; template: string } | null;
  /** Admin panel URL prefix (e.g. `"/admin"`). */
  adminPrefix: string;
  /**
   * Bar buttons contributed through the `bar.actions` capability point
   * (`PluginApi.capabilities.contribute("bar.actions", fn)`), in plugin
   * registration order. Call each with the bar action context. A bar-owning
   * plugin (e.g. `@dune/plugin-inline-edit`) collects other plugins' buttons here.
   *
   * @since 0.36.0
   */
  barActions: readonly ((ctx: AdminBarActionContext) => AdminBarAction[])[];
}

/**
 * Passed to {@link DunePlugin.mount} — provides everything a plugin needs to
 * register Fresh routes and wire up runtime services.
 *
 * @since 0.24.0
 */
export interface MountApi {
  /**
   * The Fresh `App` instance. Register routes, middleware, and layouts via
   * `app.get()`, `app.use()`, `app.route()`, etc.
   */
  // deno-lint-ignore no-explicit-any
  app: import("fresh").App<any>;
  /**
   * The booted site: engine, config, storage, search, hooks, history, flex,
   * image cache, metrics, submissions, sections, authz and the job scheduler.
   * A curated slice, not core's whole bootstrap result.
   */
  runtime: import("../plugin-api/runtime.ts").PluginRuntime;
  /** The same services object `setup()` received (`PluginApi.services`). */
  services: import("../plugin-api/services.ts").PluginServices;
  /**
   * What plugins provide: `capabilities.get("auth.session")`, `.list("admin.pages")`.
   * Slots are resolved before `mount()` runs; read them lazily (at request
   * time) rather than assuming a provider exists.
   */
  capabilities: import("../plugin-api/capabilities.ts").CapabilityReader;
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
  /**
   * Inject the content query API into the hook context so handlers can read
   * ctx.content. Called once by bootstrap.ts right after it builds the
   * ContentApi — before that point, ctx.content is undefined for any hook
   * that fires earlier in the bootstrap sequence.
   */
  setContentApi(api: ContentApi): void;
  /**
   * Resolve once every plugin's `setup()` — including async ones — has
   * settled. `registerPlugin()` fires-and-forgets `setup()` so registration
   * itself never blocks, but consumers that depend on setup-time state
   * being fully initialized (e.g. `mountPlugins()`, which calls `mount()`
   * shortly after all plugins register) must await this first. A plugin
   * whose `setup()` rejects is still counted as settled here — the error is
   * already logged by the registry, so this never rejects.
   *
   * @since 1.3.0
   */
  whenSetupComplete(): Promise<void>;
}
