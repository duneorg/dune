/**
 * Content module — public API for content management.
 */

// Types
export type {
  Collection,
  CollectionDefinition,
  CollectionSource,
  ContentFormat,
  ContentFormatHandler,
  ContentPageProps,
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
  calculateDepth,
  getParentPath,
  isContentFile,
  isInDraftsFolder,
  isInModuleFolder,
  isMediaFile,
  isMetadataFile,
  parseContentFilename,
  parseFolderName,
  sourcePathToRoute,
} from "./path-utils.ts";
export type { FileInfo, FolderInfo } from "./path-utils.ts";

// Index builder
export { buildIndex, updateIndex } from "./index-builder.ts";
export type { BuildResult, IndexBuilderOptions, IndexError, TaxonomyMap } from "./index-builder.ts";
