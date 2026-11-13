/**
 * HTTP caching module — page cache, ETag helpers, per-route policy.
 */

export { createPageCache } from "./page-cache.ts";
export type { PageCache, PageCacheEntry, PageCacheOptions, PageCacheStats } from "./page-cache.ts";

export { computeEtag, etagMatches } from "./etag.ts";

export { buildCacheControl, resolvePolicy } from "./policy.ts";
export type { CachePolicyDefaults, HttpCacheRule, ResolvedCachePolicy } from "./policy.ts";
