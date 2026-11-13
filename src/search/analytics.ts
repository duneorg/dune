/**
 * Search query analytics — bounded, aggregated, persisted as a small snapshot.
 *
 * `GET /api/search` is public, so recording must not grow with traffic. Instead
 * of logging every request, one counter per normalised query is kept in memory
 * (`count` and `totalResults`), capped at {@link MAX_DISTINCT_QUERIES}. When the
 * cap is reached the lowest-count entry is evicted, so a flood of one-off
 * queries cannot displace the frequent ones. Memory and disk therefore stay
 * bounded (a few hundred KB) whatever the traffic.
 *
 * The counters are written to a JSON snapshot, atomically (temp file + rename),
 * at most once per {@link FLUSH_INTERVAL_MS} and only when something changed, and
 * loaded again at startup. A crash loses at most one interval of counts.
 * `summarize()` reads memory only. Delete the snapshot to reset the counts.
 *
 * Counts become approximate only once more than {@link MAX_DISTINCT_QUERIES}
 * distinct queries have been seen: an evicted query starts again from zero if
 * it comes back. The top of the list stays accurate.
 */

import { dirname, join } from "@std/path";
import type { DuneConfig } from "../config/types.ts";
import { resolveRuntimeDir } from "../forms/config.ts";

// === Types ===

/** One search event, as recorded */
export interface SearchAnalyticsEntry {
  /** The query as typed */
  query: string;
  /** Number of results the search returned */
  resultCount: number;
  /** Unix epoch milliseconds */
  timestamp: number;
}

/** Aggregated summary of recorded search events */
export interface SearchAnalyticsSummary {
  /** Total number of search events recorded since `since` */
  totalSearches: number;
  /** Unix epoch milliseconds of the first recorded search; null when none */
  since: number | null;
  /**
   * Most-searched queries, sorted by count descending.
   * Each entry also carries the average result count for that query.
   */
  topQueries: Array<{
    query: string;
    count: number;
    avgResults: number;
  }>;
  /**
   * Queries that returned zero results, sorted by count descending.
   * Useful for discovering missing content.
   */
  zeroResultQueries: Array<{
    query: string;
    count: number;
  }>;
}

/** Public interface for the search analytics recorder */
export interface SearchAnalytics {
  /** Count one search. Synchronous and cheap; persistence happens in the background. */
  record(entry: SearchAnalyticsEntry): void;
  /**
   * Summarise the counters.
   * @param limit - Maximum entries in each list (default: 20)
   */
  summarize(limit?: number): Promise<SearchAnalyticsSummary>;
  /** Write any unsaved counts now (call on shutdown). */
  flush(): Promise<void>;
}

// === Limits ===

/** Distinct normalised queries kept; the lowest-count one is evicted beyond this. */
export const MAX_DISTINCT_QUERIES = 2000;
/** Longest query kept; longer ones are truncated. */
export const MAX_QUERY_LENGTH = 100;
/** How often unsaved counts are written. */
export const FLUSH_INTERVAL_MS = 30_000;

interface Counter {
  count: number;
  totalResults: number;
}

interface Snapshot {
  version: 1;
  since: number | null;
  totalSearches: number;
  queries: Record<string, Counter>;
}

function normalise(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ").slice(0, MAX_QUERY_LENGTH).trim();
}

// === Implementation ===

/**
 * The recorder for a site, or null when `system.search.analytics` is off.
 * The snapshot lives under `system.runtime_dir` (default `.dune/admin`) in the site root.
 */
export function resolveSearchAnalytics(config: DuneConfig, root: string): SearchAnalytics | null {
  if (config.system?.search?.analytics !== true) return null;
  const runtimeDir = resolveRuntimeDir(config);
  return createSearchAnalytics(join(root, runtimeDir, "search-analytics.json"));
}

/**
 * Create a recorder persisted to `snapshotPath` (loaded lazily on first use).
 *
 * @param snapshotPath - Absolute path of the JSON snapshot. Its directory is created on first write.
 * @param opts.flushIntervalMs - Override {@link FLUSH_INTERVAL_MS} (tests).
 * @param opts.maxQueries - Override {@link MAX_DISTINCT_QUERIES} (tests).
 */
export function createSearchAnalytics(
  snapshotPath: string,
  opts: { flushIntervalMs?: number; maxQueries?: number } = {},
): SearchAnalytics {
  const flushIntervalMs = opts.flushIntervalMs ?? FLUSH_INTERVAL_MS;
  const maxQueries = opts.maxQueries ?? MAX_DISTINCT_QUERIES;

  const counters = new Map<string, Counter>();
  let totalSearches = 0;
  let since: number | null = null;
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let writing: Promise<void> = Promise.resolve();

  // Counts saved by an earlier run are merged in before the first record or summary.
  const loaded: Promise<void> = (async () => {
    try {
      const snap = JSON.parse(await Deno.readTextFile(snapshotPath)) as Snapshot;
      if (snap?.version !== 1) return;
      since = snap.since;
      totalSearches = snap.totalSearches;
      for (const [q, c] of Object.entries(snap.queries ?? {})) counters.set(q, { ...c });
    } catch {
      // No snapshot yet, or unreadable: start empty.
    }
  })();
  let ready = false;
  loaded.then(() => ready = true);

  function evictLowest(): void {
    let lowest: string | undefined;
    let lowestCount = Infinity;
    for (const [q, c] of counters) {
      if (c.count < lowestCount) {
        lowest = q;
        lowestCount = c.count;
      }
    }
    if (lowest !== undefined) counters.delete(lowest);
  }

  function apply(entry: SearchAnalyticsEntry): void {
    const q = normalise(entry.query);
    if (!q) return;
    totalSearches++;
    since ??= entry.timestamp;
    const existing = counters.get(q);
    if (existing) {
      existing.count++;
      existing.totalResults += entry.resultCount;
    } else {
      if (counters.size >= maxQueries) evictLowest();
      counters.set(q, { count: 1, totalResults: entry.resultCount });
    }
    dirty = true;
  }

  function schedule(): void {
    if (timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      void flush();
    }, flushIntervalMs);
    // A pending flush must not keep the process alive.
    Deno.unrefTimer(timer as unknown as number);
  }

  function flush(): Promise<void> {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    writing = writing.then(async () => {
      await loaded;
      if (!dirty) return;
      dirty = false;
      const snap: Snapshot = {
        version: 1,
        since,
        totalSearches,
        queries: Object.fromEntries(counters),
      };
      const tmp = `${snapshotPath}.${crypto.randomUUID().slice(0, 8)}.tmp`;
      try {
        await Deno.mkdir(dirname(snapshotPath), { recursive: true });
        await Deno.writeTextFile(tmp, JSON.stringify(snap));
        await Deno.rename(tmp, snapshotPath);
      } catch (err) {
        dirty = true; // try again next time
        console.warn(`[dune] search analytics: failed to save snapshot: ${err}`);
        await Deno.remove(tmp).catch(() => {});
      }
    });
    return writing;
  }

  return {
    record(entry: SearchAnalyticsEntry): void {
      if (ready) {
        apply(entry);
        schedule();
      } else {
        // First records race the snapshot load; apply them once it is in.
        void loaded.then(() => {
          apply(entry);
          schedule();
        });
      }
    },

    async summarize(limit = 20): Promise<SearchAnalyticsSummary> {
      await loaded;
      const sorted = [...counters.entries()].sort(([, a], [, b]) => b.count - a.count);
      return {
        totalSearches,
        since,
        topQueries: sorted.slice(0, limit).map(([query, { count, totalResults }]) => ({
          query,
          count,
          avgResults: Math.round(totalResults / count),
        })),
        zeroResultQueries: sorted
          .filter(([, { count, totalResults }]) => totalResults / count < 0.5)
          .slice(0, limit)
          .map(([query, { count }]) => ({ query, count })),
      };
    },

    flush,
  };
}
