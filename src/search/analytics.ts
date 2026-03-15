/**
 * Search query analytics — lightweight JSONL-based recording and summarisation.
 *
 * Each search query is appended as a single JSON line to a `.jsonl` file inside
 * the admin runtime directory.  Summaries are computed on-demand by reading
 * and aggregating that file, so there is no separate aggregation job to run.
 *
 * Design constraints:
 *   - Append-only writes: safe under concurrent requests (each write is atomic
 *     at the OS level for small payloads).
 *   - On-demand reads: `summarize()` reads the whole file; suitable for
 *     low-to-medium traffic sites.  For high-traffic deployments, trim the
 *     file periodically or replace with a KV-backed implementation.
 *   - No external dependencies: uses only Deno built-ins.
 */

import { dirname } from "@std/path";

// === Types ===

/** One recorded search event */
export interface SearchAnalyticsEntry {
  /** Normalised query string */
  query: string;
  /** Number of results the search returned */
  resultCount: number;
  /** Unix epoch milliseconds */
  timestamp: number;
}

/** Aggregated summary of recorded search events */
export interface SearchAnalyticsSummary {
  /** Total number of search events recorded */
  totalSearches: number;
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
  /** Append one search event to the log */
  record(entry: SearchAnalyticsEntry): Promise<void>;
  /**
   * Aggregate and return a summary of recorded events.
   * @param limit - Maximum entries in each list (default: 20)
   */
  summarize(limit?: number): Promise<SearchAnalyticsSummary>;
}

// === Implementation ===

/**
 * Create a search analytics instance backed by a JSONL file.
 *
 * @param jsonlPath - Absolute path to the `.jsonl` log file.
 *                   The file and its parent directory are created on first write.
 */
export function createSearchAnalytics(jsonlPath: string): SearchAnalytics {
  return {
    async record(entry: SearchAnalyticsEntry): Promise<void> {
      try {
        await Deno.mkdir(dirname(jsonlPath), { recursive: true });
        await Deno.writeTextFile(
          jsonlPath,
          JSON.stringify(entry) + "\n",
          { append: true },
        );
      } catch (err) {
        // Analytics failures must never surface to the end user
        console.warn(`[dune] search analytics: failed to record entry: ${err}`);
      }
    },

    async summarize(limit = 20): Promise<SearchAnalyticsSummary> {
      let raw: string;
      try {
        raw = await Deno.readTextFile(jsonlPath);
      } catch {
        // File doesn't exist yet — return empty summary
        return { totalSearches: 0, topQueries: [], zeroResultQueries: [] };
      }

      // Parse lines, skipping blank or malformed entries
      const entries: SearchAnalyticsEntry[] = [];
      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          entries.push(JSON.parse(trimmed) as SearchAnalyticsEntry);
        } catch {
          // Skip malformed lines
        }
      }

      if (entries.length === 0) {
        return { totalSearches: 0, topQueries: [], zeroResultQueries: [] };
      }

      // Aggregate: query → { count, totalResults }
      const agg = new Map<string, { count: number; totalResults: number }>();
      for (const e of entries) {
        const q = e.query.trim().toLowerCase();
        if (!q) continue;
        const existing = agg.get(q);
        if (existing) {
          existing.count++;
          existing.totalResults += e.resultCount;
        } else {
          agg.set(q, { count: 1, totalResults: e.resultCount });
        }
      }

      // Build sorted lists
      const sorted = [...agg.entries()].sort(
        ([, a], [, b]) => b.count - a.count,
      );

      const topQueries = sorted.slice(0, limit).map(([query, { count, totalResults }]) => ({
        query,
        count,
        avgResults: Math.round(totalResults / count),
      }));

      const zeroResultQueries = sorted
        .filter(([, { totalResults, count }]) => totalResults / count < 0.5)
        .slice(0, limit)
        .map(([query, { count }]) => ({ query, count }));

      return {
        totalSearches: entries.length,
        topQueries,
        zeroResultQueries,
      };
    },
  };
}
