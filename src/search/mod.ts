/**
 * Search module — full-text search over content.
 *
 * @module
 */

export {
  /** Create a search engine. */
  createSearchEngine,
  resolveFacetValue,
} from "./engine.ts";
export type {
  /** Full-text search engine over the Dune content index. Obtain via {@link createSearchEngine}. */
  SearchEngine,
  SearchEngineOptions,
  /** A single result returned by {@link SearchEngine.search}. */
  SearchResult,
  SearchEngineCreateContext,
  SearchRecordsCollectContext,
  InjectedSearchRecord,
} from "./engine.ts";

// Re-export PageIndex from content types for plugin consumers.
export type {
  /** Lightweight page reference for the content index (never loads full content) */
  PageIndex,
} from "../content/types.ts";

export { createSearchManager } from "./manager.ts";
export type { SearchManager } from "./manager.ts";

export { createSearchAnalytics } from "./analytics.ts";
export type { SearchAnalytics, SearchAnalyticsEntry, SearchAnalyticsSummary } from "./analytics.ts";
