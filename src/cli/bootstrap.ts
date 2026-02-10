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
import { createAdminHandler } from "../admin/server.ts";
import { createWorkflowEngine } from "../workflow/engine.ts";
import { createScheduler } from "../workflow/scheduler.ts";
import { createHistoryEngine } from "../history/engine.ts";
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
import type { WorkflowEngine } from "../workflow/engine.ts";
import type { Scheduler } from "../workflow/scheduler.ts";
import type { HistoryEngine } from "../history/engine.ts";
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
}

export interface BootstrapOptions {
  debug?: boolean;
  buildSearch?: boolean;
}

/**
 * Bootstrap the full Dune engine from a root directory.
 */
export async function bootstrap(
  root: string,
  options: BootstrapOptions = {},
): Promise<BootstrapResult> {
  const { debug = false, buildSearch = false } = options;

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
  formats.register(new MdxHandler());

  // 4. Engine
  const engine = await createDuneEngine({
    storage,
    config,
    formats,
    storageRoot: root,
  });

  await engine.init();

  // 5. Hooks
  const hooks = createHookRegistry({ config, storage });
  await hooks.fire("onConfigLoaded", config);
  await hooks.fire("onStorageReady", storage);
  await hooks.fire("onContentIndexReady", engine.pages);

  // 6. Taxonomy engine
  const taxonomy = createTaxonomyEngine({
    pages: engine.pages,
    taxonomyMap: engine.taxonomyMap,
  });

  // 7. Collection engine
  const collections = createCollectionEngine({
    pages: engine.pages,
    taxonomyMap: engine.taxonomyMap,
    loadPage: engine.loadPage,
  });

  // 8. Search engine
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
  const workflowDataDir = config.admin?.dataDir ?? ".dune/admin";

  const workflow = createWorkflowEngine({
    storage,
    dataDir: workflowDataDir,
  });

  const scheduler = createScheduler({
    storage,
    dataDir: workflowDataDir,
  });

  const history = createHistoryEngine({
    storage,
    dataDir: workflowDataDir,
    maxRevisions: 50,
  });

  // 11. Admin panel
  const adminConfig = config.admin ?? {
    path: "/admin",
    sessionLifetime: 86400,
    dataDir: ".dune/admin",
    enabled: true,
  };

  const users = createUserManager({
    storage,
    usersDir: `${adminConfig.dataDir}/users`,
  });

  const sessions = createSessionManager({
    storage,
    sessionsDir: `${adminConfig.dataDir}/sessions`,
    lifetime: adminConfig.sessionLifetime,
  });

  const auth = createAuthMiddleware({ sessions, users });

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
      })
    : async (_req: Request) => null as Response | null;

  // Ensure a default admin user exists on first run
  if (adminConfig.enabled) {
    const result = await users.ensureDefaultAdmin();
    if (result.created) {
      console.log(`\n  🔑 Default admin created — username: admin, password: ${result.password}`);
      console.log(`     Change this password after first login.\n`);
    }
  }

  return {
    engine, storage, config, formats, collections, taxonomy,
    search, hooks, imageHandler, imageProcessor, imageCache,
    adminHandler, users, sessions, auth,
    workflow, scheduler, history,
  };
}
