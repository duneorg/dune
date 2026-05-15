/**
 * CLI bootstrap — shared setup logic for CLI commands.
 * Creates storage, loads config, registers format handlers, and creates the engine.
 */

import { createStorage } from "../storage/mod.ts";
import { loadConfig } from "../config/mod.ts";
import { FormatRegistry } from "../content/formats/registry.ts";
import { MarkdownHandler } from "../content/formats/markdown.ts";
import { TsxHandler } from "../content/formats/tsx.ts";
import { MdxHandler } from "../content/formats/mdx.ts";
import { createMdxComponentRegistry } from "../content/formats/mdx-components.ts";
import { createDuneEngine } from "../core/engine.ts";
import { createCollectionEngine } from "../collections/engine.ts";
import { createTaxonomyEngine } from "../taxonomy/engine.ts";
import { createSearchEngine } from "../search/engine.ts";
import { createHookRegistry } from "../hooks/registry.ts";
import { createImageProcessor } from "../images/processor.ts";
import { createImageCache } from "../images/cache.ts";
import { createImageHandler } from "../images/handler.ts";
import { createUserManager } from "../admin/auth/users.ts";
import { createSessionManager } from "../admin/auth/sessions.ts";
import { createSessionStore } from "../session/mod.ts";
import { createAuthMiddleware } from "../admin/auth/middleware.ts";
import { LocalRateLimitStore } from "../security/rate-limit-store.ts";
import type { RateLimitStore } from "../security/rate-limit-store.ts";
import { LocalAuthProvider } from "../admin/auth/local-provider.ts";
import { LdapAuthProvider } from "../admin/auth/ldap-provider.ts";
import { SamlAuthProvider } from "../admin/auth/saml-provider.ts";
import { initAdminContext } from "../admin/context.ts";
import { initContent } from "../content/api.ts";
import { createWorkflowEngine } from "../workflow/engine.ts";
import { createScheduler } from "../workflow/scheduler.ts";
import { createHistoryEngine } from "../history/engine.ts";
import { createSubmissionManager } from "../admin/submissions.ts";
import { createFlexEngine } from "../flex/engine.ts";
import { loadPlugins, loadPluginAdminConfigs } from "../plugins/loader.ts";
import { createStagingEngine } from "../staging/engine.ts";
import { createCommentManager } from "../admin/comments.ts";
import { createCollabManager } from "../collab/mod.ts";
import { AuditLogger } from "../audit/mod.ts";
import { MetricsCollector } from "../metrics/mod.ts";
import { createMachineTranslator } from "../mt/mod.ts";
import type { MachineTranslator } from "../mt/mod.ts";
import { createDuneAuthSystem, bootstrapAdminTuples } from "../auth/authz.ts";
import type { DuneAuthSystem } from "../auth/authz.ts";
import type { AuthzLocalAdapter } from "../auth/authz-adapter-local.ts";
import { initTracer } from "../tracing/mod.ts";
import { createCdnProvider } from "../cdn/providers/mod.ts";
import { CdnManager } from "../cdn/manager.ts";
import { join, resolve } from "@std/path";
import { logger, initLogger } from "../core/logger.ts";
import type { DuneEngine } from "../core/engine.ts";
import type { CollectionEngine } from "../collections/engine.ts";
import type { TaxonomyEngine } from "../taxonomy/engine.ts";
import type { SearchEngine } from "../search/engine.ts";
import type { HookRegistry } from "../hooks/types.ts";
import type { ImageHandler } from "../images/handler.ts";
import type { ImageProcessor } from "../images/processor.ts";
import type { ImageCache } from "../images/cache.ts";
import type { UserManager } from "../admin/auth/users.ts";
import type { SessionManager } from "../admin/auth/sessions.ts";
import type { AuthMiddleware } from "../admin/auth/middleware.ts";
import type { AuthProvider } from "../admin/auth/provider.ts";
import type { WorkflowEngine } from "../workflow/engine.ts";
import type { Scheduler } from "../workflow/scheduler.ts";
import type { HistoryEngine } from "../history/engine.ts";
import type { SubmissionManager } from "../admin/submissions.ts";
import type { FlexEngine } from "../flex/engine.ts";
import type { StagingEngine } from "../staging/engine.ts";
import type { CollabManager } from "../collab/mod.ts";
import type { DuneConfig } from "../config/types.ts";
import type { StorageAdapter } from "../storage/types.ts";

export interface BootstrapResult {
  engine: DuneEngine;
  storage: StorageAdapter;
  config: DuneConfig;
  formats: FormatRegistry;
  collections: CollectionEngine;
  taxonomy: TaxonomyEngine;
  search: SearchEngine;
  hooks: HookRegistry;
  imageHandler: ImageHandler;
  imageProcessor: ImageProcessor;
  imageCache: ImageCache;
  users: UserManager;
  sessions: SessionManager;
  auth: AuthMiddleware;
  workflow: WorkflowEngine;
  scheduler: Scheduler;
  history: HistoryEngine;
  submissionManager: SubmissionManager;
  flexEngine: FlexEngine;
  stagingEngine: StagingEngine;
  /** Real-time collaboration manager */
  collabManager: CollabManager;
  /** Map of plugin name → absolute asset directory path */
  pluginAssetDirs: Map<string, string>;
  /** Absolute path to shared themes dir (multisite only), for static file serving */
  sharedThemesDir?: string;
  /** Active authentication provider (local by default, or external if configured) */
  authProvider: AuthProvider;
  /** Audit logger — null when admin is disabled or audit.enabled is false */
  auditLogger: AuditLogger | null;
  /** In-process performance metrics collector */
  metrics: MetricsCollector;
  /** Machine translation provider — null when not configured */
  mt: MachineTranslator | null;
  /** Custom admin pages registered by plugins, for programmatic Fresh route wiring */
  pluginAdminPages: import("../admin/context.ts").AdminPageRegistration[];
  /** Public-facing routes registered by plugins */
  pluginPublicRoutes: import("../hooks/types.ts").PublicRouteRegistration[];
  /**
   * The per-site AdminContext object.
   * Null when admin is disabled. In multisite, each site gets its own BootstrapResult
   * with its own AdminContext — use this instead of getAdminContext() to avoid the
   * singleton bug where the last-bootstrapped site overwrites the global.
   */
  adminContext: import("../admin/context.ts").AdminContext | null;
  /**
   * Pre-created authz system. Present when auth.mode is "dune" and authzStore is "local".
   * `mountDuneAuth()` reuses this rather than creating a second instance, so that
   * admin-user tuples and site-user tuples share the same in-memory index.
   */
  authz?: DuneAuthSystem;
  /** Paired adapter for the authz system above — needed for hasTuple / bootstrap. */
  authzAdapter?: AuthzLocalAdapter;
}

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
   * Custom authentication provider. When supplied, takes precedence over
   * `admin.auth_provider` in system.yaml. Use this to inject a fully custom
   * provider (e.g. OpenID Connect, internal SSO) without modifying config files.
   *
   * @example
   * ```ts
   * import { bootstrap } from "@dune/core";
   * import { MyOidcProvider } from "./auth/oidc-provider.ts";
   *
   * const ctx = await bootstrap("./", { authProvider: new MyOidcProvider() });
   * ```
   */
  authProvider?: AuthProvider;
}

/** Select an AuthProvider from config, defaulting to local passwords. */
function resolveAuthProvider(
  cfg: import("../config/types.ts").AdminConfig["auth_provider"],
  users: UserManager,
): AuthProvider {
  if (!cfg || cfg.type === "local") return new LocalAuthProvider(users);
  // The LDAP and SAML providers are unimplemented stubs whose
  // authenticate() throws on call. Selecting them previously produced an
  // admin DoS at first login attempt: every request to the login route
  // crashed without a clear startup signal. Refuse to start so operators
  // discover the misconfiguration up-front.
  if (cfg.type === "ldap" || cfg.type === "saml") {
    throw new Error(
      `[dune] auth_provider.type "${cfg.type}" is not implemented in this release. ` +
      `Set auth_provider.type to "local" (or remove the auth_provider section) ` +
      `to use the built-in local password store. ` +
      `LDAP and SAML are tracked for a future release.`,
    );
  }
  // Any other unrecognized value is an admin typo — fail closed rather
  // than silently fall back to local auth.
  throw new Error(
    `[dune] auth_provider.type "${(cfg as { type?: string }).type ?? "<missing>"}" is not recognized. ` +
    `Valid values: "local" (default).`,
  );
}

/**
 * Bootstrap the full Dune engine from a root directory.
 */
export async function bootstrap(
  root: string,
  options: BootstrapOptions = {},
): Promise<BootstrapResult> {
  const { debug = false, buildSearch = false, sharedThemesDir, dev = false } = options;
  root = resolve(root); // normalise "." or relative paths to absolute

  // 1. Storage
  const storage = createStorage({ rootDir: root });

  // 2. Config
  const config = await loadConfig({
    storage,
    rootDir: root,
    skipConfigTs: false,
  });

  if (debug) {
    config.system.debug = true;
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
          logger.debug("mdx.components.loaded", { theme: config.theme.name, components: names });
        }
      } else {
        logger.warn("mdx.components.invalid", {
          path: mdxComponentsPath,
          message: "default export must be a plain object — MDX components not loaded",
        });
        mdxHandler = new MdxHandler();
      }
    } catch (err) {
      logger.warn("mdx.components.load-failed", { path: mdxComponentsPath, error: String(err) });
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

  // 5a. Plugin loading — load admin-saved config overrides first, then
  // import and register each plugin so their hooks are in place before
  // the lifecycle events fire.
  const adminCfg = config.admin ?? { dataDir: "data", runtimeDir: ".dune/admin" };
  await loadPluginAdminConfigs(config, storage, adminCfg.dataDir ?? "data");
  await loadPlugins({ config, hooks, storage, root });

  // Collect plugin asset dirs, template dirs, admin pages, and public routes.
  const pluginAssetDirs = new Map<string, string>();
  const pluginTemplateDirs: string[] = [];
  const pluginAdminPages: import("../admin/context.ts").AdminPageRegistration[] = [];
  const pluginPublicRoutes: import("../hooks/types.ts").PublicRouteRegistration[] = [];
  for (const plugin of hooks.plugins()) {
    if (plugin.assetDir) pluginAssetDirs.set(plugin.name, plugin.assetDir);
    if (plugin.templateDir) pluginTemplateDirs.push(plugin.templateDir);
    if (plugin.adminPages) pluginAdminPages.push(...plugin.adminPages);
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
  const search = createSearchEngine({
    pages: engine.pages,
    storage,
    contentDir: config.system.content.dir,
    formats,
  });

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

  // 10. Workflow, scheduling, and history
  const adminConfig = config.admin ?? {
    path: "/admin",
    sessionLifetime: 86400,
    dataDir: "data",
    runtimeDir: ".dune/admin",
    enabled: true,
  };

  const runtimeDir = adminConfig.runtimeDir ?? ".dune/admin";
  const dataDir = adminConfig.dataDir ?? "data";

  const workflow = createWorkflowEngine(
    { storage, dataDir: runtimeDir },
    config.site.workflow ?? undefined,
  );

  const scheduler = createScheduler({
    storage,
    dataDir: runtimeDir,
  });

  const history = createHistoryEngine({
    storage,
    dataDir: runtimeDir,
    maxRevisions: adminConfig.maxRevisions ?? 50,
  });

  const stagingEngine = createStagingEngine({
    storage,
    runtimeDir,
  });

  const commentManager = createCommentManager({ dataDir, runtimeDir });

  // 11. Real-time collaboration
  const collabManager = createCollabManager({
    storage,
    engine,
    history,
    contentDir: config.system.content.dir,
  });

  // 12. Admin panel
  const users = createUserManager({
    storage,
    usersDir: `${dataDir}/users`,
  });

  // Migration warning: detect users left in the old .dune/admin/users location
  const legacyUsersDir = ".dune/admin/users";
  if (await storage.exists(legacyUsersDir)) {
    try {
      const legacyEntries = await storage.list(legacyUsersDir);
      if (legacyEntries.some((e) => e.name.endsWith(".json"))) {
        logger.warn("admin.users.legacy-location", {
          legacyDir: legacyUsersDir,
          newDir: `${dataDir}/users`,
          message: "Move user files or a new default admin will be created",
        });
      }
    } catch { /* ignore */ }
  }

  // Session store — resolve backend from config, defaulting to local file-backed.
  // createSessionStore is async (may open a KV handle), so we await it here.
  const sessionStoreCfg = config.system?.session_store;
  const resolvedSessionStore = await createSessionStore({
    type: sessionStoreCfg?.type ?? "local",
    redisUrl: sessionStoreCfg?.url
      ? (sessionStoreCfg.url.startsWith("$")
        ? Deno.env.get(sessionStoreCfg.url.slice(1))
        : sessionStoreCfg.url)
      : undefined,
    storage,
    sessionsDir: `${runtimeDir}/sessions`,
    lifetime: adminConfig.sessionLifetime,
  });

  const sessions = createSessionManager({
    store: resolvedSessionStore,
    lifetime: adminConfig.sessionLifetime,
  });

  // Rate-limit store — always LocalRateLimitStore for now; operators can
  // replace this by constructing a KVRateLimitStore or RedisRateLimitStore
  // and passing it via a custom bootstrap wrapper.
  const rateLimitStore: RateLimitStore = new LocalRateLimitStore();

  // Auth provider — select based on BootstrapOptions injection first, then
  // admin.auth_provider config, falling back to local passwords.
  const authProvider: AuthProvider = options.authProvider
    ?? resolveAuthProvider(config.admin?.auth_provider, users);

  // Set Secure cookie flag unless running in a local dev environment.
  // "localhost" and other HTTP dev setups cannot set Secure cookies via HTTP
  // (except on localhost in most browsers, where the browser grants an exception).
  // Default to true (production-safe); disable via the dev option or DUNE_ENV=dev.
  const secureCookies = !dev && Deno.env.get("DUNE_ENV") !== "dev";
  const auth = createAuthMiddleware({
    sessions,
    users,
    secure: secureCookies,
    trustForwardedFor: config.system?.trusted_proxies === true,
  });

  // Authorization (polizy) — create the authz bundle and bootstrap admin users.
  // Site-user tuples are bootstrapped later in mountDuneAuth() once the site
  // user store is available. Both bootstrap calls use this same adapter so they
  // share the in-memory tuple index.
  //
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
  const _authzStoreCfg = (_siteAuthCfg?.authzStore as string | undefined)
    ?? (_siteAuthMode === "dune" ? "local" : undefined);

  let bootstrappedAuthz: DuneAuthSystem | undefined;
  let bootstrappedAuthzAdapter: AuthzLocalAdapter | undefined;

  if (adminConfig.enabled && _authzStoreCfg === "local") {
    try {
      const bundle = createDuneAuthSystem({ authzStore: "local", dataDir }, storage);
      bootstrappedAuthz = bundle.authz;
      bootstrappedAuthzAdapter = bundle.adapter;
      const allAdminUsers = await users.list();
      await bootstrapAdminTuples(bootstrappedAuthz, bootstrappedAuthzAdapter, allAdminUsers);
    } catch (err) {
      console.warn("[dune/authz] Admin authz bootstrap failed, falling back to ROLE_PERMISSIONS:", err);
      bootstrappedAuthz = undefined;
      bootstrappedAuthzAdapter = undefined;
    }
  }

  const submissionManager = createSubmissionManager({
    storage,
    submissionsDir: `${dataDir}/submissions`,
  });

  // 13. Audit logger
  // Resolve the audit log path under the site root. Reject absolute or
  // ..-traversed paths that escape the root: an admin-supplied audit
  // path that escapes (e.g. "/etc/cron.d/foo" or "../../etc/something")
  // would let the audit logger overwrite arbitrary files at write time.
  let auditLogger: AuditLogger | null = null;
  if (adminConfig.enabled !== false && adminConfig.audit?.enabled !== false) {
    const configuredPath = adminConfig.audit?.logFile;
    const auditLogFile = configuredPath
      ? join(root, configuredPath) // join() normalizes ".." so we can detect escapes below
      : join(root, runtimeDir, "audit.log");
    // Reject if the resolved path escapes the site root. We use string-prefix
    // containment (root + sep) which suffices for the file paths used here;
    // the audit log is created during init() so realpath isn't an option yet.
    const containmentRoot = root.endsWith("/") || root.endsWith("\\") ? root : root + "/";
    if (!auditLogFile.startsWith(containmentRoot)) {
      throw new Error(
        `[dune] admin.audit.logFile must resolve under the site root. ` +
        `Got: ${configuredPath} -> ${auditLogFile}`,
      );
    }
    auditLogger = new AuditLogger({ logFile: auditLogFile });
    await auditLogger.init();
  }

  // 14. Machine translation
  const mt: MachineTranslator | null = config.site.machine_translation
    ? createMachineTranslator(config.site.machine_translation)
    : null;

  // 15. Metrics collector
  const metricsEnabled = config.system.metrics?.enabled !== false;
  const metrics = new MetricsCollector({
    slowQueryThresholdMs: config.system.metrics?.slowQueryThresholdMs ?? 100,
  });

  // Record page count on every rebuild via the onRebuild hook.
  if (metricsEnabled) {
    hooks.on("onRebuild", async () => {
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
          console.log(`[dune] cdn: purged ${routes.length} route(s) via ${cdnProvider.name}`);
        }
      } catch (err) {
        console.warn(`[dune] cdn: purge failed: ${err}`);
      }
    });
  }

  // Build the per-site AdminContext object. Also initialize the singleton so
  // single-site code paths (serve.ts, dev.ts) can still call getAdminContext().
  // In multisite, fresh-app.ts threads this object through ctx.state.adminContext
  // instead of relying on the singleton, avoiding the last-writer-wins bug.
  let adminContextObj: import("../admin/context.ts").AdminContext | null = null;
  if (adminConfig.enabled) {
    adminContextObj = {
      engine,
      storage,
      config,
      auth,
      users,
      sessions,
      prefix: adminConfig.path ?? "/admin",
      authProvider,
      workflow,
      scheduler,
      history,
      submissions: submissionManager,
      flex: flexEngine,
      hooks,
      staging: stagingEngine,
      comments: commentManager,
      collab: collabManager,
      imageCache,
      auditLogger: auditLogger ?? undefined,
      metrics: metricsEnabled ? metrics : undefined,
      mt,
      rateLimitStore,
      pluginPages: pluginAdminPages.length > 0 ? pluginAdminPages : undefined,
      authz: bootstrappedAuthz,
    };
    initAdminContext(adminContextObj);
  }

  // Initialize the content API singleton so getContent() works in Fresh routes.
  // This is always safe to call — headless developers need it, full-mode
  // developers can use it as an escape hatch, and it's a no-op after the first call.
  initContent({ engine, search, collections, taxonomy });

  // Ensure a default admin user exists on first run
  if (adminConfig.enabled) {
    const result = await users.ensureDefaultAdmin();
    if (result.created) {
      console.log(`\n  🔑 Default admin created — username: admin`);
      console.log(`     Password written to: ${result.passwordFile}`);
      console.log(`     Read it, then delete the file and change your password.\n`);
    }
  }

  return {
    engine, storage, config, formats, collections, taxonomy,
    search, hooks, imageHandler, imageProcessor, imageCache,
    users, sessions, auth,
    authProvider,
    workflow, scheduler, history,
    submissionManager,
    flexEngine,
    stagingEngine,
    collabManager,
    pluginAssetDirs,
    sharedThemesDir,
    auditLogger,
    metrics,
    mt,
    pluginAdminPages,
    pluginPublicRoutes,
    adminContext: adminContextObj,
    authz: bootstrappedAuthz,
    authzAdapter: bootstrappedAuthzAdapter,
  };
}
