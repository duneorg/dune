/**
 * CLI bootstrap — shared setup logic for CLI commands.
 * Creates storage, loads config, registers format handlers, and creates the engine.
 */

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
import type { SearchManager } from "../search/manager.ts";
import { createHookRegistry } from "../hooks/registry.ts";
import { createImageProcessor } from "../images/processor.ts";
import { createImageCache } from "../images/cache.ts";
import { createImageHandler } from "../images/handler.ts";
import { createHistoryEngine } from "../history/engine.ts";
import { createFlexEngine } from "../flex/engine.ts";
import { loadPluginAdminConfigs, loadPlugins } from "../plugins/loader.ts";
import { MetricsCollector } from "../metrics/mod.ts";
import { createDuneAuthSystem } from "../auth/authz.ts";
import type { DuneAuthSystem } from "../auth/authz.ts";
import type { AuthzLocalAdapter } from "../auth/authz-adapter-local.ts";
import type { AuthzDbAdapter } from "../auth/authz-adapter-db.ts";
import { loadHmacKeyFromEnv } from "../auth/authz-hmac.ts";
import { initTracer } from "../tracing/mod.ts";
import { createCdnProvider } from "../cdn/providers/mod.ts";
import { CdnManager } from "../cdn/manager.ts";
import { initContent } from "../content/api.ts";
import { resolve } from "@std/path";
import { initLogger, logger } from "../core/logger.ts";
import type { DuneEngine } from "../core/engine.ts";
import type { CollectionEngine } from "../collections/engine.ts";
import type { TaxonomyEngine } from "../taxonomy/engine.ts";
import type { SearchEngine } from "../search/engine.ts";
import type { HookRegistry, DunePlugin } from "../hooks/types.ts";
import type { ImageHandler } from "../images/handler.ts";
import type { ImageProcessor } from "../images/processor.ts";
import type { ImageCache } from "../images/cache.ts";
import type { HistoryEngine } from "../history/engine.ts";
import type { FlexEngine } from "../flex/engine.ts";
import type { DuneConfig } from "../config/types.ts";
import type { StorageAdapter } from "../storage/types.ts";

/**
 * Minimal auth-provider interface for the admin panel.
 * The concrete `AuthProvider` type lives in `@dune/plugin-admin/admin/auth/provider`;
 * this stub lets core accept it without creating a hard publish-time dependency.
 * @since 0.24.0
 */
export interface AdminAuthProvider {
  readonly type: string;
  authenticate(credentials: { username: string; password: string; [k: string]: unknown }): Promise<{ id: string; [k: string]: unknown } | null>;
  initiateLogin?(req: Request): Promise<string | null>;
  handleCallback?(req: Request): Promise<{ id: string; [k: string]: unknown } | null>;
}

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
  imageHandler: ImageHandler;
  imageProcessor: ImageProcessor;
  imageCache: ImageCache;
  /**
   * Revision history engine — stays in core because it is part of the
   * `AdminServicesContext` passed to plugins' `adminServices()` factories, and
   * because `@dune/plugin-inline-edit` may need it independently of the admin plugin.
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
   * The per-site AdminContext object — null until `@dune/plugin-admin`'s `mount()` runs.
   * In multisite, each site gets its own BootstrapResult with its own AdminContext.
   */
  /** Populated by `@dune/plugin-admin`'s `mount()` hook; `null` until then. */
  adminContext: Record<string, unknown> | null;
  /**
   * Pre-created authz system. Present when auth.mode is "dune" and authzStore is "local".
   * Shared between `@dune/plugin-admin` (admin-user tuples) and `mountDuneAuth()`
   * (site-user tuples) so both pools use the same in-memory index.
   */
  authz?: DuneAuthSystem;
  /** Paired adapter for the authz system above — needed for hasTuple / bootstrap. */
  authzAdapter?: AuthzLocalAdapter | AuthzDbAdapter;
  /**
   * Pre-loaded HMAC key for authz tuple signing — null if DUNE_AUTHZ_HMAC_SECRET
   * is absent. Passed to mountDuneAuth() so the env var is read exactly once.
   */
  hmacKey?: CryptoKey | null;
  /**
   * Merged output of all plugins' `adminServices()` factories.
   * Null until `mountPlugins()` runs (i.e. after `createDuneApp()`).
   * Exposed here so core can register routes (e.g. `/api/inline-edit/ws`)
   * that depend on plugin-contributed services without coupling to plugin-admin.
   */
  adminServices: import("../hooks/types.ts").AdminServices | null;
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
   * When true, disables the Secure cookie flag so session cookies work over
   * plain HTTP in local dev. Defaults to false (production-safe).
   * Also honoured when DUNE_ENV=dev is set in the environment.
   */
  dev?: boolean;
  /**
   * Custom authentication provider for the admin panel.
   *
   * When supplied, takes precedence over `admin.auth_provider` in system.yaml.
   * Forwarded to the built-in admin plugin (`@dune/plugin-admin`). When running
   * a custom admin plugin that handles its own auth, this option is ignored.
   *
   * @example
   * ```ts
   * import { bootstrap } from "@dune/core";
   * import { MyOidcProvider } from "./auth/oidc-provider.ts";
   *
   * const ctx = await bootstrap("./", { authProvider: new MyOidcProvider() });
   * ```
   */
  authProvider?: AdminAuthProvider;
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
  const { debug = false, buildSearch = false, sharedThemesDir, dev = false } =
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
      const mod = await import(`file://${absPath}`);
      if (mod.default && typeof mod.default === "object") {
        const registry = createMdxComponentRegistry(
          mod.default as Record<string, unknown>,
        );
        mdxHandler = new MdxHandler({ components: registry });
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

  await engine.init();

  // 5. Hooks
  const hooks = createHookRegistry({ config, storage });

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
  const adminCfg = config.admin ??
    { dataDir: "data", runtimeDir: ".dune/admin" };
  await loadPluginAdminConfigs(config, storage, adminCfg.dataDir ?? "data");
  await loadPlugins({ config, hooks, storage, root });

  // Collect plugin asset dirs, template dirs, and public routes.
  // pluginAdminPages are no longer aggregated here — @dune/plugin-admin's
  // mount() reads them from hooks.plugins() and stores them on AdminContext.pluginPages.
  const pluginAssetDirs = new Map<string, string>();
  const pluginTemplateDirs: string[] = [];
  const pluginPublicRoutes:
    import("../hooks/types.ts").PublicRouteRegistration[] = [];
  for (const plugin of hooks.plugins()) {
    if (plugin.assetDir) pluginAssetDirs.set(plugin.name, plugin.assetDir);
    if (plugin.templateDir) pluginTemplateDirs.push(plugin.templateDir);
    if (plugin.publicRoutes) pluginPublicRoutes.push(...plugin.publicRoutes);
  }

  // Register plugin template dirs with the engine so plugins can provide
  // additional templates that themes can fall back to.
  if (pluginTemplateDirs.length > 0) {
    engine.setPluginTemplateDirs(pluginTemplateDirs);
  }

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

  const searchContentDir = config.system.content.dir;
  const builtInEngine = createSearchEngine({
    pages: engine.pages,
    storage,
    contentDir: searchContentDir,
    formats,
    injectedRecords,
  });
  const search = createSearchManager(builtInEngine);

  const engineCtx = await hooks.fire<SearchEngineCreateContext>(
    "onSearchEngineCreate",
    {
      register: (name, eng) => search.register(name, eng),
      setActiveEngine: (name) => search.setActiveEngine(name),
      engine: null,
      pages: engine.pages,
      injectedRecords,
      storage,
      contentDir: searchContentDir,
      config,
      formats,
      loadText: (page) =>
        loadPageBodyText(page, {
          storage,
          contentDir: searchContentDir,
          formats,
        }),
    },
  );

  // Legacy backwards-compat: if a plugin set ctx.engine directly (old API),
  // register it as "default" and activate it.
  if (engineCtx.engine) {
    search.register("default", engineCtx.engine);
    search.setActiveEngine("default");
  }

  if (buildSearch) {
    await search.build();
  }

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

  // 10. History engine — stays in core so AdminServicesContext and @dune/plugin-inline-edit
  // can both access it without depending on the admin plugin.
  const adminConfig = config.admin ?? {
    path: "/admin",
    sessionLifetime: 86400,
    dataDir: "data",
    runtimeDir: ".dune/admin",
    enabled: true,
  };
  const runtimeDir = adminConfig.runtimeDir ?? ".dune/admin";
  const dataDir = adminConfig.dataDir ?? "data";

  const history = createHistoryEngine({
    storage,
    dataDir: runtimeDir,
    maxRevisions: adminConfig.maxRevisions ?? 50,
  });

  // 11. Authorization (Polizy) — created in core so that admin-user tuples
  // (@dune/plugin-admin) and site-user tuples (mountDuneAuth) share one index.
  // Reading auth mode from site config (public auth, not the admin auth provider).
  // deno-lint-ignore no-explicit-any
  const _siteAuthCfg = ((config.site as any).auth) as
    | Record<string, unknown>
    | undefined;
  const _siteAuthMode = (_siteAuthCfg?.mode as string | undefined) ?? "dune";
  // In "dune" mode authzStore defaults to "local".
  // In "external-jwt" mode authzStore must be explicitly opted into — no default,
  // because an external JWT provider owns roles in that topology and we must not
  // silently create a local tuple store that would never be consulted.
  const _authzStoreCfg = (_siteAuthCfg?.authzStore as string | undefined) ??
    (_siteAuthMode === "dune" ? "local" : undefined);

  let bootstrappedAuthz: DuneAuthSystem | undefined;
  let bootstrappedAuthzAdapter: AuthzLocalAdapter | AuthzDbAdapter | undefined;

  // Load HMAC key once — shared by admin and site-user authz bundles.
  const hmacKey = await loadHmacKeyFromEnv().catch((err) => {
    console.error("[dune/authz] Invalid DUNE_AUTHZ_HMAC_SECRET:", err.message);
    return null;
  });

  if (adminConfig.enabled !== false && _authzStoreCfg === "local") {
    try {
      const bundle = createDuneAuthSystem({
        authzStore: "local",
        dataDir,
        hmacKey,
      }, storage);
      bootstrappedAuthz = bundle.authz;
      bootstrappedAuthzAdapter = bundle.adapter;
      // Admin-user tuples are bootstrapped by @dune/plugin-admin's mount() hook
      // after it creates the UserManager. Core only creates the empty system here.
    } catch (err) {
      console.warn(
        "[dune/authz] Authz system creation failed, falling back to ROLE_PERMISSIONS:",
        err,
      );
    }
  }

  // 12. Register the built-in admin plugin before user plugins so user plugins
  // can override its services via adminServices(). The plugin's setup() runs
  // immediately (via hooks.registerPlugin); mount() runs later in mountPlugins().
  // Non-literal dynamic import breaks the circular publish-time dependency between
  // @dune/core and @dune/plugin-admin (each would otherwise need the other to be
  // on JSR before it could be published).
  if (adminConfig.enabled !== false) {
    const adminPkg = "jsr:@dune/plugin-admin";
    const { createAdminPlugin } = await import(adminPkg) as { // lockfile-safe: constant ("jsr:@dune/plugin-admin", avoids circular publish-time dep)
      createAdminPlugin: (config: DuneConfig, storage: StorageAdapter, opts: Record<string, unknown>) => DunePlugin;
    };
    const adminPlugin = createAdminPlugin(config, storage, {
      root,
      dev,
      authProvider: options.authProvider,
      authz: bootstrappedAuthz,
      authzAdapter: bootstrappedAuthzAdapter,
      hmacKey,
    } as Record<string, unknown>);
    hooks.registerPlugin(adminPlugin);
  }

  // 13. Metrics collector
  const metricsEnabled = config.system.metrics?.enabled !== false;
  const metrics = new MetricsCollector({
    slowQueryThresholdMs: config.system.metrics?.slowQueryThresholdMs ?? 100,
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
          console.log(
            `[dune] cdn: purged ${routes.length} route(s) via ${cdnProvider.name}`,
          );
        }
      } catch (err) {
        console.warn(`[dune] cdn: purge failed: ${err}`);
      }
    });
  }

  // Initialize the content API singleton so getContent() works in Fresh routes.
  initContent({ engine, search, collections, taxonomy });

  return {
    engine,
    storage,
    config,
    formats,
    collections,
    taxonomy,
    search,
    hooks,
    imageHandler,
    imageProcessor,
    imageCache,
    history,
    flexEngine,
    pluginAssetDirs,
    sharedThemesDir,
    metrics,
    pluginPublicRoutes,
    // adminContext is null until @dune/plugin-admin's mount() runs inside mountPlugins()
    adminContext: null,
    // adminServices is null until mountPlugins() runs inside createDuneApp()
    adminServices: null,
    authz: bootstrappedAuthz,
    authzAdapter: bootstrappedAuthzAdapter,
    hmacKey,
  };
}
