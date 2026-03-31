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
import { createAuthMiddleware } from "../admin/auth/middleware.ts";
import { LocalAuthProvider } from "../admin/auth/local-provider.ts";
import { createAdminHandler } from "../admin/server.ts";
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
import { join } from "@std/path";
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
  adminHandler: (req: Request) => Promise<Response | null>;
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
}

/**
 * Bootstrap the full Dune engine from a root directory.
 */
export async function bootstrap(
  root: string,
  options: BootstrapOptions = {},
): Promise<BootstrapResult> {
  const { debug = false, buildSearch = false, sharedThemesDir, dev = false } = options;

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
          console.log(`  ✓ MDX components loaded from theme: ${names}`);
        }
      } else {
        console.warn(
          `  ⚠️  ${mdxComponentsPath}: default export must be a plain object — MDX components not loaded`,
        );
        mdxHandler = new MdxHandler();
      }
    } catch (err) {
      console.warn(`  ⚠️  Failed to load ${mdxComponentsPath}: ${err} — MDX components not loaded`);
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

  // Collect plugin asset and template dirs after all plugins have loaded.
  const pluginAssetDirs = new Map<string, string>();
  const pluginTemplateDirs: string[] = [];
  for (const plugin of hooks.plugins()) {
    if (plugin.assetDir) pluginAssetDirs.set(plugin.name, plugin.assetDir);
    if (plugin.templateDir) pluginTemplateDirs.push(plugin.templateDir);
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
        console.warn(`\n  ⚠️  Legacy admin users found in ${legacyUsersDir}/`);
        console.warn(`     Users are now stored in ${dataDir}/users/ (git-tracked).`);
        console.warn(`     Move your user files or a new default admin will be created.\n`);
      }
    } catch { /* ignore */ }
  }

  const sessions = createSessionManager({
    storage,
    sessionsDir: `${runtimeDir}/sessions`,
    lifetime: adminConfig.sessionLifetime,
  });

  // Auth provider — local by default; swap to LDAP/SAML when configured.
  // Currently only LocalAuthProvider is fully implemented; LDAP and SAML
  // providers are stubs that satisfy the interface and throw NotImplemented.
  const authProvider: AuthProvider = new LocalAuthProvider(users);

  // Set Secure cookie flag unless running in a local dev environment.
  // "localhost" and other HTTP dev setups cannot set Secure cookies via HTTP
  // (except on localhost in most browsers, where the browser grants an exception).
  // Default to true (production-safe); disable via the dev option or DUNE_ENV=dev.
  const secureCookies = !dev && Deno.env.get("DUNE_ENV") !== "dev";
  const auth = createAuthMiddleware({ sessions, users, secure: secureCookies });

  const submissionManager = createSubmissionManager({
    storage,
    submissionsDir: `${dataDir}/submissions`,
  });

  // 13. Audit logger
  let auditLogger: AuditLogger | null = null;
  if (adminConfig.enabled !== false && adminConfig.audit?.enabled !== false) {
    const auditLogFile = adminConfig.audit?.logFile
      ? (adminConfig.audit.logFile.startsWith("/")
          ? adminConfig.audit.logFile
          : join(root, adminConfig.audit.logFile))
      : join(root, runtimeDir, "audit.log");
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

  const adminHandler = adminConfig.enabled
    ? createAdminHandler({
        engine,
        storage,
        config,
        auth,
        users,
        sessions,
        prefix: adminConfig.path,
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
        mt: mt ?? undefined,
        authProvider,
      })
    : async (_req: Request) => null as Response | null;

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
    adminHandler, users, sessions, auth,
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
  };
}
