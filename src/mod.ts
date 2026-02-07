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
export type { DuneConfig, SiteConfig, SystemConfig, ThemeConfig } from "./config/types.ts";

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
