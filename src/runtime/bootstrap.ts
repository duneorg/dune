/**
 * CLI bootstrap — shared setup logic for CLI commands.
 * Creates storage, loads config, registers format handlers, and creates the engine.
 *
 * @module
 */

import { createPluginServices } from "../plugin-api/create-services.ts";
import { type CapabilityReader, type CapabilityRegistry, createCapabilityRegistry } from "../plugin-api/capabilities.ts";
import type { PluginServices } from "../plugin-api/services.ts";
import { resolveDataDir, resolveMaxRevisions, resolveRuntimeDir } from "../forms/config.ts";
import { startupStep } from "./startup-step.ts";
import { createStorageAsync } from "../storage/mod.ts";
import { loadConfig } from "../config/mod.ts";
import { FormatRegistry } from "../content/formats/registry.ts";
import { MarkdownHandler } from "../content/formats/markdown.ts";
import { TsxHandler } from "../content/formats/tsx.ts";
import { MdxHandler } from "../content/formats/mdx.ts";
import { createMdxComponentRegistry } from "../content/formats/mdx-components.ts";
import { createDuneEngine } from "../core/engine.ts";
import { createCollectionEngine } from "../collections/engine.ts";
import { createTaxonomyEngine } from "../taxonomy/engine.ts";
import { createSearchEngine, loadPageBodyText } from "../search/engine.ts";
import type {
  SearchEngineCreateContext,
  SearchRecordsCollectContext,
} from "../search/engine.ts";
import { createSearchManager } from "../search/manager.ts";
import { searchOptionsFromConfig } from "../search/config.ts";
import { initFlags } from "../flags/mod.ts";
import { resolveSearchAnalytics } from "../search/analytics.ts";
import type { SearchAnalytics } from "../search/analytics.ts";
import type { SearchManager } from "../search/manager.ts";
import { createHookRegistry } from "../hooks/registry.ts";
import { createImageProcessor } from "../images/processor.ts";
import { createImageCache } from "../images/cache.ts";
import { createImageHandler } from "../images/handler.ts";
import { createHistoryEngine } from "../history/engine.ts";
import { createFlexEngine } from "../flex/engine.ts";
import { loadPluginAdminConfigs, loadPlugins } from "../plugins/loader.ts";
import { MetricsCollector } from "../metrics/mod.ts";
import { bootstrapRoleGrants, createDuneAuthSystem } from "../auth/authz.ts";
import { automaticAdminTierGrants } from "../auth/automatic-grants.ts";
import { resolveRoleGrants } from "../auth/role-grants.ts";
import type { DuneAuthSystem } from "../auth/authz.ts";
import type { AuthzLocalAdapter } from "../auth/authz-adapter-local.ts";
import type { AuthzDbAdapter } from "../auth/authz-adapter-db.ts";
import { loadHmacKeyFromEnv } from "../auth/authz-hmac.ts";
import { buildDuneAuthzSchema, DUNE_BASE_AUTHZ_ACTIONS } from "../auth/authz-schema.ts";
import type { AuthzRelation } from "../auth/authz-schema.ts";
import { initTracer } from "../tracing/mod.ts";
import { sectionRegistry } from "../sections/registry.ts";
import type { SectionRegistry } from "../sections/registry.ts";
import { createCdnProvider } from "../cdn/providers/mod.ts";
import { CdnManager } from "../cdn/manager.ts";
import { createContentApi, type ContentApi } from "../content/api.ts";
import { resolve, toFileUrl } from "@std/path";
import { initLogger, logger } from "../core/logger.ts";
import { resolveSessionPrefix } from "../session/prefix.ts";
import type { DuneEngine } from "../core/engine.ts";
import type { CollectionEngine } from "../collections/engine.ts";
import type { TaxonomyEngine } from "../taxonomy/engine.ts";
import type { HookRegistry, DunePlugin } from "../hooks/types.ts";
import type { ImageHandler } from "../images/handler.ts";
import type { ImageProcessor } from "../images/processor.ts";
import type { ImageCache } from "../images/cache.ts";
import type { HistoryEngine } from "../history/engine.ts";
import type { FlexEngine } from "../flex/engine.ts";
import type { DuneConfig } from "../config/types.ts";
import { createSubmissionManager } from "../forms/submissions.ts";
import { resolveFormsConfig } from "../forms/config.ts";
import type { StorageAdapter } from "../storage/types.ts";

/** All services produced by a successful `bootstrap()` call. */
export interface BootstrapResult {
  engine: DuneEngine;
  storage: StorageAdapter;
  config: DuneConfig;
  formats: FormatRegistry;
  collections: CollectionEngine;
  taxonomy: TaxonomyEngine;
  search: SearchManager;
  hooks: HookRegistry;
  /** Services handed to plugins (`PluginApi.services` / `MountApi.services`). */
  pluginServices: PluginServices;
  /** What plugins provide (auth session, inline editing, ...); resolved before `mount()`. */
  capabilities: CapabilityReader;
  /**
   * The job scheduler, set by `dune serve` once it exists (it is created per
   * serving process, not at bootstrap). Plugins that show job status read it
   * lazily from here; this is the future `PluginRuntime.jobs`.
   */
  jobScheduler?: import("../jobs/mod.ts").JobScheduler;
  /** Core-only: declares and resolves capabilities. Plugins see `capabilities` instead. */
  capabilityRegistry: CapabilityRegistry;
  imageHandler: ImageHandler;
  imageProcessor: ImageProcessor;
  imageCache: ImageCache;
  /**
   * Revision history engine — stays in core because it is part of the
   * `CapabilityContext` passed to plugins' capability factories, and because
   * `@dune/plugin-inline-edit` may need it independently of the admin plugin.
   */
  history: HistoryEngine;
  /**
   * Flex Objects engine — stays in core because public collections can source
   * data from flex objects (the `@flex` collection type).
   */
  flexEngine: FlexEngine;
  /** Map of plugin name → absolute asset directory path */
  pluginAssetDirs: Map<string, string>;
  /** Absolute path to shared themes dir (multisite only), for static file serving */
  sharedThemesDir?: string;
  /** In-process performance metrics collector */
  metrics: MetricsCollector;
  /** Public-facing routes registered by plugins */
  pluginPublicRoutes: import("../hooks/types.ts").PublicRouteRegistration[];
  /**
   * Store for public form submissions (`<data_dir>/submissions/<form>/`).
   * Core writes to it from the public form routes; an admin plugin reads it
   * to manage them.
   * @since v0.35.2
   */
  submissions: import("../forms/submissions.ts").SubmissionManager;
  /**
   * Section registry for the Visual Page Builder. Handed to
   * `@dune/plugin-admin` through this result so the admin panel reads the
   * same registry instance the renderer uses, instead of importing the
   * module-level singleton from its own (potentially separately-resolved)
   * copy of `@dune/core`. Currently the shared singleton; per-site
   * registries would slot in here.
   * @since v0.31
   */
  sections: SectionRegistry;
  /**
   * Content query API bound to this bootstrap's engine context.
   * Replaces `getContent()` from `@dune/core/content` — no singleton, no global state.
   * @since v0.26
   */
  contentApi: ContentApi;
  /** Query recorder for `/api/search`; null unless `system.search.analytics` is on. */
  searchAnalytics: SearchAnalytics | null;
  /**
   * Pre-created authz system. Present when auth.mode is "dune" and authzStore is "local".
   * Shared between `@dune/plugin-admin` (admin-user tuples) and `mountDuneAuth()`
   * (site-user tuples) so both pools use the same in-memory index.
   */
  authz?: DuneAuthSystem;
  /** Paired adapter for the authz system above — needed for hasTuple / bootstrap. */
  authzAdapter?: AuthzLocalAdapter | AuthzDbAdapter;
  /**
   * This site's actual polizy schema — Dune's built-in actions plus
   * whatever any registered plugin contributed via `DunePlugin.authzActions`.
   * The `authz` system above is already built against this; exposed
   * separately for any caller that needs the schema itself (e.g.
   * `roleHasPermission()`'s synchronous, non-`authz.check()` path in
   * `runPluginResponseTransforms()`), rather than the plain built-in-only
   * `duneAuthzSchema` module export, which never sees this site's plugins.
   */
  authzSchema: import("../auth/authz-schema.ts").DuneAuthzSchema;
  /**
   * Pre-loaded HMAC key for authz tuple signing — null if DUNE_AUTHZ_HMAC_SECRET
   * is absent. Passed to mountDuneAuth() so the env var is read exactly once.
   */
  hmacKey?: CryptoKey | null;
}

/** Options accepted by `bootstrap()`. All fields are optional. */
export interface BootstrapOptions {
  debug?: boolean;
  buildSearch?: boolean;
  /**
   * Absolute path to a shared themes directory (multi-site setups).
   * Passed through to the engine so shared themes can be resolved when
   * the active theme is not found in the site's own `themes/` directory.
   */
  sharedThemesDir?: string;
  /**
   * Path prefix this site is served under (multisite `path_prefix` routing).
   * Set on `config.site.basePath` after config load — see `SiteConfig.basePath`.
   */
  basePath?: string;
  /**
   * This site's id in `config/sites.yaml` (multisite). Scopes the Redis/KV
   * session keys to the site unless `system.session_store.prefix` is set.
   */
  siteId?: string;
  /**
   * When true, disables the Secure cookie flag so session cookies work over
   * plain HTTP in local dev. Defaults to false (production-safe).
   * Also honoured when DUNE_ENV=dev is set in the environment.
   */
  dev?: boolean;
  /**
   * Pre-created storage adapter to use instead of the default filesystem/KV
   * adapter derived from `root`. When supplied, the `root` parameter is used
   * only as a logical identifier (e.g. for logging) — no filesystem access is
   * performed. Intended for use by `@dune/testing`'s `createTestHarness()`.
   */
  storage?: StorageAdapter;
  /**
   * Plugin instances to register before any lifecycle hooks fire.
   * Plugins supplied here are registered immediately after the hook registry
   * is created, before `loadPlugins()` processes `site.yaml` entries.
   * Intended for use by `@dune/testing`'s `createTestHarness()` so plugin
   * hooks participate in the full bootstrap lifecycle.
   */
  plugins?: DunePlugin[];
  /**
   * Top-level DuneConfig overrides applied after all config files are loaded.
   * Useful for forcing specific config values in tests without writing config
   * files. Deep-merged over the loaded config.
   * Intended for use by `@dune/testing`'s `createTestHarness()`.
   */
  configOverrides?: Partial<DuneConfig>;
}


/**
 * Bootstrap the full Dune engine from a root directory.
 */
export async function bootstrap(
  root: string,
  options: BootstrapOptions = {},
): Promise<BootstrapResult> {
  const { debug = false, buildSearch = false, sharedThemesDir, basePath, dev = false } =
    options;
  // Only resolve to an absolute path when not using an injected storage —
  // the harness passes a synthetic root that doesn't exist on disk.
  if (!options.storage) {
    root = resolve(root);
  }

  // 1. Storage — use injected adapter (e.g. MemoryStorageAdapter for tests) or
  // auto-select filesystem / KV based on environment.
  const storage = options.storage ?? await createStorageAsync({ rootDir: root });

  // 2. Config
  const config = await loadConfig({
    storage,
    rootDir: root,
    // Skip dune.config.ts when storage is injected (no real rootDir on disk).
    skipConfigTs: !!options.storage,
  });

  if (debug) {
    config.system.debug = true;
  }

  if (basePath) {
    config.site.basePath = basePath;
  }

  // Multisite: scope shared session backends (Redis, KV) to this site.
  const sessionPrefix = resolveSessionPrefix(
    config.system.session_store?.prefix,
    options.siteId,
  );
  if (sessionPrefix !== undefined) {
    config.system.session_store = { ...config.system.session_store, prefix: sessionPrefix };
  }

  // Apply test/harness config overrides after all file-based config is loaded.
  if (options.configOverrides) {
    for (const [k, v] of Object.entries(options.configOverrides)) {
      if (v !== undefined) {
        // deno-lint-ignore no-explicit-any
        (config as any)[k] = v;
      }
    }
  }

  // Initialize the global logger from config (config.system.logging) or env vars.
  // Do this early so all subsequent bootstrap steps emit structured logs.
  initLogger({
    format: config.system.logging?.format,
    level: config.system.logging?.level,
  });

  // 3. Format handlers
  const formats = new FormatRegistry();
  formats.register(new MarkdownHandler());
  formats.register(new TsxHandler());

  // Auto-load MDX components from the active theme if present.
  // Convention: themes/{name}/mdx-components.ts must default-export
  // an object mapping component names to Preact component functions.
  // e.g. export default { Alert, Chart, Callout }
  let mdxHandler: MdxHandler;
  const mdxComponentsPath = `themes/${config.theme.name}/mdx-components.ts`;
  if (await storage.exists(mdxComponentsPath)) {
    try {
      const absPath = await Deno.realPath(`${root}/${mdxComponentsPath}`);
      const mod = await import(toFileUrl(absPath).href); // lockfile-safe: site-local file; a `file://${...}` template here is rewritten by `deno publish` into a broken relative specifier
      if (mod.default && typeof mod.default === "object") {
        const registry = createMdxComponentRegistry(
          mod.default as Record<string, unknown>,
        );
        // Optional named export: sanitizer allowances for the markup the
        // theme's components emit (see MdxSanitizeExtension).
        const sanitize = mod.sanitize && typeof mod.sanitize === "object"
          ? mod.sanitize
          : undefined;
        mdxHandler = new MdxHandler({ components: registry, sanitize });
        if (debug) {
          const names = Object.keys(mod.default).join(", ");
          logger.debug("mdx.components.loaded", {
            theme: config.theme.name,
            components: names,
          });
        }
      } else {
        logger.warn("mdx.components.invalid", {
          path: mdxComponentsPath,
          message:
            "default export must be a plain object — MDX components not loaded",
        });
        mdxHandler = new MdxHandler();
      }
    } catch (err) {
      logger.warn("mdx.components.load-failed", {
        path: mdxComponentsPath,
        error: String(err),
      });
      mdxHandler = new MdxHandler();
    }
  } else {
    mdxHandler = new MdxHandler();
  }
  formats.register(mdxHandler);

  // 4. Engine
  const engine = await createDuneEngine({
    storage,
    config,
    formats,
    storageRoot: root,
    sharedThemesDir,
  });

  await startupStep("Failed to index content", () => engine.init());

  // 5. Hooks
  // The authz system is created further down; plugins reach it only through
  // services.authz, so the getter resolves it at call time.
  const searchAnalytics = resolveSearchAnalytics(config, root);
  let authzForServices: { authz: DuneAuthSystem; adapter: AuthzLocalAdapter | AuthzDbAdapter } | undefined;
  const pluginServices = createPluginServices({
    config,
    storage,
    getBlueprints: () => engine.blueprints,
    searchAnalytics,
    getAuthz: () => authzForServices,
  });
  const capabilityRegistry = createCapabilityRegistry();
  const hooks = createHookRegistry({ config, storage, services: pluginServices, capabilities: capabilityRegistry });
  // The engine was created before the registry; without this it never fired onRebuild or onThemeSwitch.
  engine.setHooks(hooks);

  // 5a. Pre-registered plugins (e.g. from @dune/testing harness) — registered
  // before loadPlugins() so their hooks participate in the full lifecycle.
  if (options.plugins) {
    for (const plugin of options.plugins) {
      hooks.registerPlugin(plugin);
    }
  }

  // 5b. Plugin loading — load admin-saved config overrides first, then
  // import and register each plugin so their hooks are in place before
  // the lifecycle events fire.
  await loadPluginAdminConfigs(config, storage, resolveDataDir(config));
  await startupStep("Failed to load plugins", () => loadPlugins({ config, hooks, storage, root, dev }));

  // Collect plugin asset dirs, template dirs, and public routes.
  // pluginAdminPages are no longer aggregated here — @dune/plugin-admin's
  // mount() reads them from hooks.plugins() and stores them on AdminContext.pluginPages.
  const pluginAssetDirs = new Map<string, string>();
  const pluginTemplateDirs: string[] = [];
  const pluginPublicRoutes:
    import("../hooks/types.ts").PublicRouteRegistration[] = [];
  // Plugin-contributed authz actions — collected here (after every plugin's
  // setup() has run) so buildDuneAuthzSchema() below can merge them in
  // before the site's authz system is created. First declaration wins on a
  // name collision (built-in or cross-plugin) — dropped with a logged
  // warning, never silently merged/overwritten, so a typo'd or malicious
  // plugin can't redefine what an existing action means.
  const pluginAuthzActions: Record<string, readonly AuthzRelation[]> = {};
  for (const plugin of hooks.plugins()) {
    if (plugin.assetDir) pluginAssetDirs.set(plugin.name, plugin.assetDir);
    if (plugin.templateDir) pluginTemplateDirs.push(plugin.templateDir);
    if (plugin.publicRoutes) pluginPublicRoutes.push(...plugin.publicRoutes);
    if (plugin.authzActions) {
      for (const [action, relations] of Object.entries(plugin.authzActions)) {
        if (action in DUNE_BASE_AUTHZ_ACTIONS) {
          logger.warn("bootstrap.authz_actions.collides_with_builtin", {
            plugin: plugin.name,
            action,
          });
          continue;
        }
        if (action in pluginAuthzActions) {
          logger.warn("bootstrap.authz_actions.collides_with_plugin", {
            plugin: plugin.name,
            action,
          });
          continue;
        }
        pluginAuthzActions[action] = relations;
      }
    }
  }
  const authzSchema = buildDuneAuthzSchema(pluginAuthzActions);

  // Register plugin template dirs with the engine so plugins can provide
  // additional templates that themes can fall back to.
  if (pluginTemplateDirs.length > 0) {
    engine.setPluginTemplateDirs(pluginTemplateDirs);
  }

  // Feature flags come from system.yaml `flags:`; resolved once, read anywhere with flag().
  initFlags(config.system.flags);

  await hooks.fire("onConfigLoaded", config);
  await hooks.fire("onStorageReady", storage);
  await hooks.fire("onContentIndexReady", engine.pages);

  // 6. Taxonomy engine
  const taxonomy = createTaxonomyEngine({
    pages: engine.pages,
    taxonomyMap: engine.taxonomyMap,
  });

  // 7. Flex Objects engine (created early — needed by collection engine)
  const flexEngine = createFlexEngine({ storage });

  // 8. Collection engine (flex engine injected for @flex collection sources)
  const collections = createCollectionEngine({
    pages: engine.pages,
    taxonomyMap: engine.taxonomyMap,
    loadPage: engine.loadPage,
    flex: flexEngine,
  });

  // 9. Search engine
  //
  // Plugins can (a) inject extra records to index via onSearchRecordsCollect,
  // and (b) replace the built-in engine entirely via onSearchEngineCreate
  // (e.g. a Meilisearch backend). When no plugin provides an engine, the
  // built-in in-memory engine is used.
  const recordsCtx = await hooks.fire<SearchRecordsCollectContext>(
    "onSearchRecordsCollect",
    { records: [] },
  );
  const injectedRecords = recordsCtx.records;

  const searchContentDir = engine.contentDir;
  const builtInEngine = createSearchEngine({
    pages: engine.pages,
    storage: engine.contentStorage,
    contentDir: searchContentDir,
    formats,
    injectedRecords,
    ...searchOptionsFromConfig(config.system.search),
  });
  const search = createSearchManager(builtInEngine, {
    failOnStartup: config.system.search?.fail_on_startup === true,
  });

  await hooks.fire<SearchEngineCreateContext>(
    "onSearchEngineCreate",
    {
      register: (name, eng) => search.register(name, eng),
      setActiveEngine: (name) => search.setActiveEngine(name),
      pages: engine.pages,
      injectedRecords,
      storage: engine.contentStorage,
      contentDir: searchContentDir,
      config,
      formats,
      loadText: (page) =>
        loadPageBodyText(page, {
          storage: engine.contentStorage,
          contentDir: searchContentDir,
          formats,
        }),
    },
  );

  if (buildSearch) {
    await search.build();
  }

  // Keep what is derived from the page index in step with it. `engine.rebuild()`
  // gives the engine a new `pages` array and nothing else holds on to it: the
  // taxonomy, the collections and the search engines were built over the old
  // one. Without this, a page the admin, inline editing or a plugin writes at
  // runtime is missing from them until the process restarts (`dune dev` and the
  // multisite watcher used to refresh them by hand; a production server never
  // did).
  //
  // The taxonomy and the collections are cheap and refresh before
  // `engine.rebuild()` returns. Search re-reads every page body, so it refreshes
  // in the background and is coalesced: a burst of saves costs one extra run,
  // not one per save, and a save does not wait for it. Each run also collects
  // the plugins' records again (`onSearchRecordsCollect`), so a record that
  // appeared or went away (a PDF added to content/) is picked up.
  let searchRefresh: Promise<void> | null = null;
  let searchRefreshAgain = false;
  const refreshSearch = async (): Promise<void> => {
    try {
      const fresh = (await hooks.fire<SearchRecordsCollectContext>("onSearchRecordsCollect", { records: [] })).records;
      // In place: engines hold this array (the built-in one, and those that kept the
      // `injectedRecords` they were handed at creation).
      injectedRecords.length = 0;
      injectedRecords.push(...fresh);
      await search.rebuild(engine.pages, injectedRecords);
    } catch (err) {
      logger.warn("search.refresh_failed", { reason: err instanceof Error ? err.message : String(err) });
    }
  };
  // An engine listener, not a hook handler: a plugin's throwing onRebuild handler must not
  // stop these indexes from following the page index.
  engine.onRebuilt(() => {
    try {
      taxonomy.rebuild(engine.pages, engine.taxonomyMap);
    } catch (err) {
      logger.warn("taxonomy.refresh_failed", { reason: err instanceof Error ? err.message : String(err) });
    }
    try {
      collections.rebuild(engine.pages, engine.taxonomyMap);
    } catch (err) {
      logger.warn("collections.refresh_failed", { reason: err instanceof Error ? err.message : String(err) });
    }
    if (!buildSearch) return;
    if (searchRefresh) {
      searchRefreshAgain = true;
      return;
    }
    searchRefresh = (async () => {
      do {
        searchRefreshAgain = false;
        await refreshSearch();
      } while (searchRefreshAgain);
    })().finally(() => {
      searchRefresh = null;
    });
  });

  // 9. Image processing pipeline
  const imageProcessor = createImageProcessor({
    defaultQuality: config.system.images.default_quality,
    allowedSizes: config.system.images.allowed_sizes,
  });

  const imageCache = createImageCache({
    storage,
    cacheDir: config.system.images.cache_dir,
  });

  const imageHandler = createImageHandler({
    engine,
    processor: imageProcessor,
    cache: imageCache,
  });

  // 10. History engine — stays in core so CapabilityContext and @dune/plugin-inline-edit
  // can both access it without depending on the admin plugin.
  const runtimeDir = resolveRuntimeDir(config);
  const dataDir = resolveDataDir(config);

  const history = createHistoryEngine({
    storage,
    dataDir: runtimeDir,
    maxRevisions: resolveMaxRevisions(config),
  });

  // 11. Authorization (Polizy) — created in core so that admin-user tuples
  // (the admin plugin) and site-user tuples (mountDuneAuth) share one index.
  // Admin-side authz is independent of `site.auth`'s (public-auth) mode.

  let bootstrappedAuthz: DuneAuthSystem | undefined;
  let bootstrappedAuthzAdapter: AuthzLocalAdapter | AuthzDbAdapter | undefined;

  // Load HMAC key once — shared by admin and site-user authz bundles.
  const hmacKey = await loadHmacKeyFromEnv().catch((err) => {
    logger.error("bootstrap.authz.hmac_key_invalid", { reason: err.message });
    return null;
  });

  // The authz system exists when something needs it: a plugin that provides
  // `editor.session` (without authz its sessions could never be authorised:
  // `pages.update` fails closed when authz is missing), a plugin that declares
  // `authzActions` of its own, or the site's own login (`site.auth`, whose
  // users are authorised through it for page gating and inline editing).
  // Plugins register, and so declare, before this point; settle async setup()
  // first so a declaration made after an await is seen too.
  await hooks.whenSetupComplete();
  const hasSessionProvider = capabilityRegistry.reader.providers().some((p) => p.name === "editor.session");
  const hasAuthzActions = Object.keys(pluginAuthzActions).length > 0;
  const hasSiteAuth = !!config.site.auth;
  if (hasSessionProvider || hasAuthzActions || hasSiteAuth) {
    try {
      const bundle = createDuneAuthSystem({
        authzStore: "local",
        dataDir,
        hmacKey,
        schema: authzSchema,
      }, storage);
      bootstrappedAuthz = bundle.authz;
      bootstrappedAuthzAdapter = bundle.adapter;
      authzForServices = { authz: bundle.authz, adapter: bundle.adapter };
      // Admin-tier roles hold their relation on the site at group level, so a
      // site user's role is enough, with or without an admin plugin.
      await bootstrapRoleGrants(bundle.authz, bundle.adapter, resolveRoleGrants(config));
      // Say where the config hands out those roles by itself (a payment product's
      // role, an identity provider's role claims). Informational: it is often the point.
      for (const g of automaticAdminTierGrants(config)) {
        logger[g.severity === "warning" ? "warn" : "info"]("auth.automatic_admin_tier_grant", {
          detail: g.message,
        });
      }
      // Admin-user tuples are bootstrapped by @dune/plugin-admin's mount() hook
      // after it creates the UserManager. Core only creates the empty system here.
    } catch (err) {
      logger.warn("bootstrap.authz.creation_failed_fallback", { reason: String(err) });
    }
  }

  // First-admin bootstrap from DUNE_ADMIN_EMAIL / DUNE_ADMIN_PASSWORD. Dune
  // never creates a default admin; this is the explicit env route (the CLI
  // route is `dune users:create --password-prompt`). Only touches the user
  // store when the env vars are set, and only when no enabled admin exists.
  if (Deno.env.get("DUNE_ADMIN_EMAIL") || Deno.env.get("DUNE_ADMIN_PASSWORD")) {
    const { ensureAdminFromEnv } = await import("../auth/bootstrap-admin.ts");
    const { createLocalUserStore } = await import("../auth/user-store.ts");
    const useDb = (config.site as { auth?: { user_store?: string } }).auth?.user_store === "db";
    let closeDb: () => Promise<void> = () => Promise.resolve();
    let userStore: import("../auth/user-store.ts").UserStore;
    if (useDb) {
      const { createDbAdapter } = await import("../db/adapters/mod.ts");
      const { createDbUserStore } = await import("../auth/user-store-db.ts");
      const dbAdapter = await createDbAdapter();
      userStore = await createDbUserStore({ adapter: dbAdapter });
      closeDb = () => dbAdapter.close();
    } else {
      userStore = createLocalUserStore({ storage, usersDir: `${dataDir}/users` });
    }
    try {
      const result = await ensureAdminFromEnv({
        userStore,
        onCreated: async (user) => {
          if (!bootstrappedAuthz || !bootstrappedAuthzAdapter) return;
          const { bootstrapAdminTuples } = await import("../auth/authz.ts");
          await bootstrapAdminTuples(bootstrappedAuthz, bootstrappedAuthzAdapter, [user]);
        },
      });
      if (result.created) {
        logger.info("bootstrap.first_admin.created", {
          username: result.username,
          source: "DUNE_ADMIN_EMAIL",
        });
      }
    } finally {
      await closeDb();
    }
  }

  // 12. There is no built-in admin: the admin is a plugin like any other and
  // loads only when site.yaml lists it under `plugins:`. Say so once when
  // nothing provides the admin's prefix, so a site that upgraded without
  // listing it can tell why the panel is gone.
  if (!capabilityRegistry.reader.providers().some((p) => p.name === "admin.prefix")) {
    logger.info("bootstrap.no_admin", {
      hint: "No plugin provides the admin panel. List jsr:@dune/plugin-admin under plugins: in config/site.yaml to run it (`dune migrate:config` adds it).",
    });
  }

  // 13. Metrics collector
  const metricsEnabled = config.system.metrics?.enabled !== false;
  const metrics = new MetricsCollector({
    slowQueryThresholdMs: config.system.metrics?.slow_query_threshold_ms ?? 100,
  });

  // Record page count on every rebuild via the onRebuild hook.
  if (metricsEnabled) {
    hooks.on("onRebuild", () => {
      metrics.recordRebuild(0, engine.pages.length);
    });
  }

  // 16.5. Distributed tracing — initialize global tracer from config.
  initTracer({
    enabled: config.system.tracing?.enabled ?? false,
    endpoint: config.system.tracing?.endpoint,
    serviceName: config.system.tracing?.service_name ?? "dune",
  });

  // 16. CDN cache invalidation — purge affected routes after every rebuild.
  const cdnProvider = createCdnProvider(config.site.cdn);
  if (cdnProvider && config.site.cdn?.base_url) {
    const cdnManager = new CdnManager({
      provider: cdnProvider,
      baseUrl: config.site.cdn.base_url,
    });
    hooks.on("onRebuild", async () => {
      try {
        // Purge all known public routes after a full rebuild.
        // Engine pages are already updated by the time onRebuild fires.
        const routes = engine.pages.map((p) => p.route);
        await cdnManager.purgeRoutes(routes);
        if (config.system.debug) {
          logger.debug("cdn.purge.completed", { routes: routes.length, provider: cdnProvider.name });
        }
      } catch (err) {
        logger.warn("cdn.purge.failed", { reason: String(err) });
      }
    });
  }

  const contentApi = createContentApi({ engine, search, collections, taxonomy });
  hooks.setContentApi(contentApi);

  return {
    engine,
    storage,
    config,
    formats,
    collections,
    taxonomy,
    search,
    hooks,
    pluginServices,
    capabilities: capabilityRegistry.reader,
    capabilityRegistry,
    imageHandler,
    imageProcessor,
    imageCache,
    history,
    flexEngine,
    pluginAssetDirs,
    sharedThemesDir,
    metrics,
    pluginPublicRoutes,
    sections: sectionRegistry,
    contentApi,
    searchAnalytics,
    submissions: createSubmissionManager({
      storage,
      submissionsDir: `${resolveFormsConfig(config).dataDir}/submissions`,
    }),
    authz: bootstrappedAuthz,
    authzAdapter: bootstrappedAuthzAdapter,
    authzSchema,
    hmacKey,
  };
}
