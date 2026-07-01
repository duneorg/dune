/**
 * Search module — full-text search over content.
 */

export { createSearchEngine, resolveFacetValue } from "./engine.ts";
export type {
  SearchEngine,
  SearchEngineOptions,
  SearchResult,
  SearchEngineCreateContext,
  SearchRecordsCollectContext,
  InjectedSearchRecord,
} from "./engine.ts";

// Re-export PageIndex from content types for plugin consumers.
export type { PageIndex } from "../content/types.ts";

export { createSearchManager } from "./manager.ts";
export type { SearchManager } from "./manager.ts";

export { createSearchAnalytics } from "./analytics.ts";
export type { SearchAnalytics, SearchAnalyticsEntry, SearchAnalyticsSummary } from "./analytics.ts";
