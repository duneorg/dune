/**
 * In-process rendered HTML cache.
 *
 * A simple TTL-based Map that stores rendered page responses so repeated
 * requests to the same URL return immediately without re-rendering.
 *
 * Entries expire after `ttl` seconds.  The cache is bounded by `maxEntries`;
 * when full, the oldest-inserted entry is evicted (FIFO approximation).
 *
 * Cache invalidation strategy: TTL-based expiry rather than explicit
 * invalidation.  A short default TTL (30 s) means stale content is served
 * for at most `ttl` seconds after a page edit — acceptable for a CMS where
 * edits are infrequent relative to reads.
 */

export interface PageCacheEntry {
  /** Rendered HTML body bytes. */
  body: Uint8Array;
  /** ETag for this entry (computed from PageIndex metadata). */
  etag: string;
  /** Pre-built Cache-Control header value for this entry. */
  cacheControl: string;
  /** Absolute timestamp (ms) when this entry expires. */
  expiresAt: number;
}

export interface PageCacheStats {
  entries: number;
  hits: number;
  misses: number;
  /** Hit rate as a fraction 0–1, or null when no requests have been made. */
  hitRate: number | null;
  evictions: number;
}

export interface PageCache {
  /** Retrieve a live (non-expired) entry, or null on miss / expiry. */
  get(key: string): PageCacheEntry | null;
  /** Store an entry.  Evicts oldest if at capacity. */
  set(key: string, entry: Omit<PageCacheEntry, "expiresAt">): void;
  /** Clear all entries (e.g. after a site rebuild). */
  invalidate(): void;
  /** Current statistics. */
  stats(): PageCacheStats;
}

export interface PageCacheOptions {
  /** Maximum number of HTML entries to keep in memory (default: 500). */
  maxEntries?: number;
  /** Entry time-to-live in seconds (default: 30). */
  ttl?: number;
}

/**
 * Create a new in-process page cache.
 */
export function createPageCache(opts: PageCacheOptions = {}): PageCache {
  const maxEntries = opts.maxEntries ?? 500;
  const ttlMs = (opts.ttl ?? 30) * 1000;

  const entries = new Map<string, PageCacheEntry>();
  let hits = 0;
  let misses = 0;
  let evictions = 0;

  return {
    get(key: string): PageCacheEntry | null {
      const entry = entries.get(key);
      if (!entry) {
        misses++;
        return null;
      }
      if (Date.now() > entry.expiresAt) {
        entries.delete(key);
        misses++;
        return null;
      }
      hits++;
      return entry;
    },

    set(key: string, entryData: Omit<PageCacheEntry, "expiresAt">): void {
      // Evict FIFO when at capacity
      if (entries.size >= maxEntries && !entries.has(key)) {
        const firstKey = entries.keys().next().value;
        if (firstKey !== undefined) {
          entries.delete(firstKey);
          evictions++;
        }
      }
      entries.set(key, { ...entryData, expiresAt: Date.now() + ttlMs });
    },

    invalidate(): void {
      entries.clear();
    },

    stats(): PageCacheStats {
      const total = hits + misses;
      return {
        entries: entries.size,
        hits,
        misses,
        hitRate: total > 0 ? hits / total : null,
        evictions,
      };
    },
  };
}
