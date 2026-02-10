/**
 * Dune CMS — Public API entry point.
 *
 * @module
 *
 * @example
 * ```ts
 * import { createDuneEngine, createStorage, loadConfig } from "@dune/cms";
 * ```
 */

// Core
export { createDuneEngine } from "./core/engine.ts";
export type { DuneEngine, DuneEngineOptions, ResolveResult, MediaResponse } from "./core/engine.ts";
export { DuneError, ConfigError, ContentError, StorageError, TemplateError, RouteError } from "./core/errors.ts";

// Storage
export { createStorage } from "./storage/mod.ts";
export type { StorageAdapter, StorageEntry, StorageStat, WatchEvent } from "./storage/types.ts";

// Config
export { loadConfig } from "./config/mod.ts";
export { validateConfig } from "./config/validator.ts";
export type { DuneConfig, SiteConfig, SystemConfig, ThemeConfig, AdminConfig } from "./config/types.ts";

// Content
export type {
  ContentFormat,
  Page,
  PageIndex,
  PageFrontmatter,
  MediaFile,
  MediaHelper,
  Collection,
  CollectionDefinition,
  CollectionSource,
  TemplateComponent,
  TemplateProps,
  ContentPageProps,
  RenderContext,
  ContentFormatHandler,
} from "./content/types.ts";
export { FormatRegistry } from "./content/formats/registry.ts";
export { MarkdownHandler } from "./content/formats/markdown.ts";
export { TsxHandler } from "./content/formats/tsx.ts";
export { MdxHandler } from "./content/formats/mdx.ts";
export type { MdxHandlerOptions } from "./content/formats/mdx.ts";
export { createMdxComponentRegistry } from "./content/formats/mdx-components.ts";
export type { MdxComponentRegistry } from "./content/formats/mdx-components.ts";
export { buildIndex, updateIndex } from "./content/index-builder.ts";
export type { BuildResult, TaxonomyMap } from "./content/index-builder.ts";
export { loadPage } from "./content/page-loader.ts";

// Routing
export { createRouteResolver } from "./routing/resolver.ts";
export type { RouteMatch, RouteResolver, RouteResolverOptions } from "./routing/resolver.ts";
export { duneRoutes } from "./routing/routes.ts";

// Themes
export { createThemeLoader } from "./themes/loader.ts";
export type { ThemeLoader } from "./themes/loader.ts";
export type { ThemeManifest, ResolvedTheme, LoadedTemplate } from "./themes/types.ts";

// Collections
export { createCollectionEngine } from "./collections/engine.ts";
export type { CollectionEngine } from "./collections/engine.ts";

// Taxonomy
export { createTaxonomyEngine } from "./taxonomy/engine.ts";
export type { TaxonomyEngine } from "./taxonomy/engine.ts";

// Hooks
export { createHookRegistry } from "./hooks/registry.ts";
export type { HookEvent, HookHandler, HookContext, DunePlugin, HookRegistry } from "./hooks/types.ts";

// Search
export { createSearchEngine } from "./search/engine.ts";
export type { SearchEngine, SearchResult } from "./search/engine.ts";

// Images
export { createImageProcessor } from "./images/processor.ts";
export type {
  ImageProcessor,
  ImageProcessingOptions,
  ImageOutputFormat,
  ImageFit,
  ProcessedImage,
  ImageProcessorConfig,
} from "./images/processor.ts";
export { createImageCache } from "./images/cache.ts";
export type { ImageCache, ImageCacheConfig, CachedImage } from "./images/cache.ts";
export { createImageHandler } from "./images/handler.ts";
export type { ImageHandler, ImageHandlerOptions } from "./images/handler.ts";

// Admin
export { createAdminHandler } from "./admin/server.ts";
export type { AdminServerConfig } from "./admin/server.ts";
export { createUserManager } from "./admin/auth/users.ts";
export type { UserManager, CreateUserInput } from "./admin/auth/users.ts";
export { createSessionManager } from "./admin/auth/sessions.ts";
export type { SessionManager } from "./admin/auth/sessions.ts";
export { createAuthMiddleware } from "./admin/auth/middleware.ts";
export type { AuthMiddleware } from "./admin/auth/middleware.ts";
export { hashPassword, verifyPassword } from "./admin/auth/passwords.ts";
export type {
  AdminUser, AdminRole, AdminSession, AdminPermission,
  AuthResult, AdminUserInfo,
} from "./admin/types.ts";
export { ROLE_PERMISSIONS, toUserInfo } from "./admin/types.ts";

// Workflow
export { createWorkflowEngine } from "./workflow/engine.ts";
export type { WorkflowEngine, WorkflowEngineConfig } from "./workflow/engine.ts";
export { createScheduler } from "./workflow/scheduler.ts";
export type { Scheduler, SchedulerConfig } from "./workflow/scheduler.ts";
export type {
  ContentStatus,
  StatusTransition,
  ScheduledAction,
  ContentRevision,
  ContentDiff,
  TranslationStatus,
} from "./workflow/types.ts";
export { TRANSITIONS } from "./workflow/types.ts";

// History
export { createHistoryEngine } from "./history/engine.ts";
export type { HistoryEngine, HistoryEngineConfig, RecordInput } from "./history/engine.ts";
export { computeDiff, applyPatch } from "./history/diff.ts";
