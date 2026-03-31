/**
 * Dune CMS — Public API entry point.
 *
 * @module
 *
 * ## Versioning (pre-1.0)
 *
 * This module follows [semantic versioning](https://semver.org). As per semver
 * convention, pre-1.0 minor releases (0.7.0, 0.8.0 …) may include breaking
 * changes. Patch releases (0.6.x) are bug-fix only.
 *
 * Stable API guarantees (no breaking changes without a major bump) begin at
 * **v1.0.0**.
 *
 * Anything not exported here is internal and may change at any time.
 *
 * @example
 * ```ts
 * import { createDuneEngine, createStorage, loadConfig } from "@dune/core";
 * import type { DunePlugin, HookEvent } from "@dune/core";
 * ```
 *
 * Sub-modules with their own stability guarantees:
 * - `@dune/core/plugins` — plugin loader and `PLUGIN_API_VERSION`
 * - `@dune/core/sections` — Visual Page Builder section types and registry
 *
 * @since 0.6.0
 */

// ── Core ───────────────────────────────────────────────────────────────────

/**
 * Create and configure a DuneEngine instance.
 * @since 0.1.0
 */
export { createDuneEngine } from "./core/engine.ts";
export type {
  /** @since 0.1.0 */
  DuneEngine,
  /** @since 0.1.0 */
  DuneEngineOptions,
  /** @since 0.1.0 */
  ResolveResult,
  /** @since 0.2.0 */
  MediaResponse,
} from "./core/engine.ts";

export {
  /** @since 0.1.0 */
  DuneError,
  ConfigError,
  ContentError,
  StorageError,
  TemplateError,
  RouteError,
} from "./core/errors.ts";

// ── Storage ────────────────────────────────────────────────────────────────

/** @since 0.1.0 */
export { createStorage } from "./storage/mod.ts";
export type {
  /** @since 0.1.0 */
  StorageAdapter,
  StorageEntry,
  StorageStat,
  WatchEvent,
} from "./storage/types.ts";

// ── Config ─────────────────────────────────────────────────────────────────

/** @since 0.1.0 */
export { loadConfig } from "./config/mod.ts";
/** @since 0.1.0 */
export { validateConfig } from "./config/validator.ts";
export type {
  /** @since 0.1.0 */
  DuneConfig,
  /** @since 0.1.0 */
  SiteConfig,
  SystemConfig,
  ThemeConfig,
  AdminConfig,
} from "./config/types.ts";

// ── Content ────────────────────────────────────────────────────────────────

export type {
  /** @since 0.1.0 */
  ContentFormat,
  /** @since 0.1.0 */
  Page,
  /** @since 0.1.0 */
  PageIndex,
  /** @since 0.1.0 */
  PageFrontmatter,
  /** @since 0.1.0 */
  MediaFile,
  MediaHelper,
  /** @since 0.1.0 */
  Collection,
  CollectionDefinition,
  CollectionSource,
  /** @since 0.1.0 */
  TemplateComponent,
  /** @since 0.1.0 */
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

// ── Routing ────────────────────────────────────────────────────────────────

export { createRouteResolver } from "./routing/resolver.ts";
export type {
  RouteMatch,
  RouteResolver,
  RouteResolverOptions,
} from "./routing/resolver.ts";
export { duneRoutes } from "./routing/routes.ts";

// ── Themes ─────────────────────────────────────────────────────────────────

export { createThemeLoader } from "./themes/loader.ts";
export type { ThemeLoader } from "./themes/loader.ts";
export type { ThemeManifest, ResolvedTheme, LoadedTemplate } from "./themes/types.ts";

// ── Collections ────────────────────────────────────────────────────────────

export { createCollectionEngine } from "./collections/engine.ts";
export type { CollectionEngine } from "./collections/engine.ts";

// ── Taxonomy ───────────────────────────────────────────────────────────────

export { createTaxonomyEngine } from "./taxonomy/engine.ts";
export type { TaxonomyEngine } from "./taxonomy/engine.ts";

// ── Hooks & Plugins ────────────────────────────────────────────────────────

export { createHookRegistry } from "./hooks/registry.ts";
export type {
  /**
   * All lifecycle event names a plugin can subscribe to.
   * This union type is frozen — new events will be added in minor versions,
   * existing events will never be removed or renamed before v2.0.
   * @since 0.1.0
   */
  HookEvent,
  /** @since 0.1.0 */
  HookHandler,
  /** @since 0.1.0 */
  HookContext,
  /**
   * Plugin definition interface.
   * Implement this to create a Dune plugin.
   * @since 0.1.0
   */
  DunePlugin,
  /**
   * API surface available to plugins during setup().
   * @since 0.1.0
   */
  PluginApi,
  HookRegistry,
} from "./hooks/types.ts";

// ── Search ─────────────────────────────────────────────────────────────────

export { createSearchEngine } from "./search/engine.ts";
export type { SearchEngine, SearchResult } from "./search/engine.ts";

// ── Images ─────────────────────────────────────────────────────────────────

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

// ── Admin ──────────────────────────────────────────────────────────────────

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
  AdminUser,
  AdminRole,
  AdminSession,
  AdminPermission,
  AuthResult,
  AdminUserInfo,
} from "./admin/types.ts";
export { ROLE_PERMISSIONS, toUserInfo } from "./admin/types.ts";

// ── Workflow ───────────────────────────────────────────────────────────────

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

// ── History ────────────────────────────────────────────────────────────────

export { createHistoryEngine } from "./history/engine.ts";
export type { HistoryEngine, HistoryEngineConfig, RecordInput } from "./history/engine.ts";
export { computeDiff, applyPatch } from "./history/diff.ts";

// ── Visual Page Builder (v0.6) ─────────────────────────────────────────────

export type {
  /**
   * A section type definition — schema for fields and rendering metadata.
   * @since 0.6.0
   */
  SectionDef,
  /**
   * A single field within a section schema.
   * @since 0.6.0
   */
  SectionField,
  SectionFieldType,
  /**
   * A section instance stored in page frontmatter under `sections:`.
   * @since 0.6.0
   */
  SectionInstance,
} from "./sections/types.ts";
export {
  /** Registry of all available section types. @since 0.6.0 */
  SectionRegistry,
  /** Shared singleton section registry. @since 0.6.0 */
  sectionRegistry,
  /** Server-side HTML renderer for an array of SectionInstances. @since 0.6.0 */
  renderSections,
} from "./sections/mod.ts";
