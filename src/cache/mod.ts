/**
 * HTTP caching module — page cache, ETag helpers, per-route policy.
 */

export { createPageCache } from "./page-cache.ts";
export type { PageCache, PageCacheEntry, PageCacheOptions, PageCacheStats } from "./page-cache.ts";

export { computeEtag, etagMatches } from "./etag.ts";

export { resolvePolicy, buildCacheControl } from "./policy.ts";
export type { HttpCacheRule, ResolvedCachePolicy, CachePolicyDefaults } from "./policy.ts";
