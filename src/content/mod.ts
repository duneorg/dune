/**
 * Content module — public API for content management.
 */

// Types
export type {
  ContentFormat,
  ContentFormatHandler,
  ContentPageProps,
  Collection,
  CollectionDefinition,
  CollectionSource,
  MediaFile,
  MediaHelper,
  Page,
  PageFrontmatter,
  PageIndex,
  RenderContext,
  TemplateComponent,
  TemplateProps,
} from "./types.ts";

// Format handlers
export { FormatRegistry } from "./formats/registry.ts";
export { MarkdownHandler } from "./formats/markdown.ts";
export { TsxHandler } from "./formats/tsx.ts";

// Path utilities
export {
  parseFolderName,
  parseContentFilename,
  sourcePathToRoute,
  calculateDepth,
  getParentPath,
  isContentFile,
  isMediaFile,
  isMetadataFile,
  isInDraftsFolder,
  isInModuleFolder,
} from "./path-utils.ts";
export type { FolderInfo, FileInfo } from "./path-utils.ts";

// Index builder
export {
  buildIndex,
  updateIndex,
} from "./index-builder.ts";
export type {
  IndexBuilderOptions,
  BuildResult,
  IndexError,
  TaxonomyMap,
} from "./index-builder.ts";
