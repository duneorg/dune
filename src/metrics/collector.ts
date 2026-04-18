/**
 * In-process performance metrics collector.
 *
 * All state is in-memory and resets on server restart.
 * recordRequest() is synchronous and safe to call on every request.
 * snapshot() is synchronous and returns a full point-in-time view.
 */

import type {
  LatencySample,
  LatencyStats,
  MetricsOptions,
  MetricsSnapshot,
  RouteMetrics,
  SlowQuery,
} from "./types.ts";
import type { PageCacheStats } from "../cache/mod.ts";

// ── Circular buffer helpers ───────────────────────────────────────────────────

function createSample(capacity: number): LatencySample {
  return {
    values: new Float64Array(capacity),
    head: 0,
    size: 0,
    capacity,
  };
}

function recordSample(sample: LatencySample, value: number): void {
  sample.values[sample.head] = value;
  sample.head = (sample.head + 1) % sample.capacity;
  if (sample.size < sample.capacity) sample.size++;
}

function computeStats(sample: LatencySample): LatencyStats {
  if (sample.size === 0) {
    return { count: 0, p50: 0, p95: 0, p99: 0, max: 0, mean: 0 };
  }

  // Copy the valid portion of the circular buffer and sort ascending.
  const sorted = Array.from(sample.values.subarray(0, sample.size)).sort((a, b) => a - b);
  const n = sorted.length;

  const percentile = (p: number): number => {
    const idx = Math.min(Math.ceil(p * n) - 1, n - 1);
    return sorted[Math.max(0, idx)];
  };

  const sum = sorted.reduce((acc, v) => acc + v, 0);

  return {
    count: n,
    p50: percentile(0.5),
    p95: percentile(0.95),
    p99: percentile(0.99),
    max: sorted[n - 1],
    mean: sum / n,
  };
}

// ── MetricsCollector ──────────────────────────────────────────────────────────

export class MetricsCollector {
  private readonly startTime: number;
  private totalRequests: number = 0;
  private totalErrors: number = 0;
  private readonly globalLatency: LatencySample;
  private readonly routeMap: Map<string, RouteMetrics>;
  private readonly slowQueryList: SlowQuery[];
  private engineStats: {
    pageCount: number;
    rebuildCount: number;
    lastRebuildMs: number | null;
  };
  private pageCacheRef: (() => PageCacheStats | null) | null = null;
  private readonly opts: Required<MetricsOptions>;

  constructor(opts: MetricsOptions = {}) {
    this.opts = {
      sampleCapacity: opts.sampleCapacity ?? 1000,
      slowQueryThresholdMs: opts.slowQueryThresholdMs ?? 100,
      maxSlowQueries: opts.maxSlowQueries ?? 20,
    };
    this.startTime = Date.now();
    this.globalLatency = createSample(this.opts.sampleCapacity);
    this.routeMap = new Map();
    this.slowQueryList = [];
    this.engineStats = { pageCount: 0, rebuildCount: 0, lastRebuildMs: null };
  }

  /** Called by site-handler or middleware on each HTTP request. Synchronous. */
  recordRequest(route: string, durationMs: number, isError: boolean): void {
    this.totalRequests++;
    if (isError) this.totalErrors++;
    recordSample(this.globalLatency, durationMs);

    let rm = this.routeMap.get(route);
    if (!rm) {
      rm = {
        route,
        requests: 0,
        errors: 0,
        latency: createSample(this.opts.sampleCapacity),
      };
      this.routeMap.set(route, rm);
    }
    rm.requests++;
    if (isError) rm.errors++;
    recordSample(rm.latency, durationMs);
  }

  /** Called after each engine rebuild. */
  recordRebuild(durationMs: number, pageCount: number): void {
    this.engineStats.rebuildCount++;
    this.engineStats.pageCount = pageCount;
    if (durationMs > 0) {
      this.engineStats.lastRebuildMs = durationMs;
    }
  }

  /** Called when a slow collection/search query is detected. */
  recordSlowQuery(
    type: "collection" | "search",
    query: string,
    durationMs: number,
  ): void {
    if (durationMs < this.opts.slowQueryThresholdMs) return;
    // Truncate the raw query string so the admin dashboard can't reveal
    // arbitrarily long user-supplied text (names/emails in search, filter
    // values in collection queries). Admins still see enough to diagnose
    // a slow pattern; full strings stay out of the metrics buffer.
    const truncated = query.length > 80 ? query.slice(0, 77) + "..." : query;
    const entry: SlowQuery = {
      ts: new Date().toISOString(),
      type,
      query: truncated,
      durationMs,
    };
    this.slowQueryList.push(entry);
    if (this.slowQueryList.length > this.opts.maxSlowQueries) {
      this.slowQueryList.shift();
    }
  }

  /** Attach a page cache for stats inclusion in snapshot. */
  setPageCacheRef(fn: () => PageCacheStats | null): void {
    this.pageCacheRef = fn;
  }

  /** Update the current page count (called e.g. from onRebuild hook). */
  setPageCount(count: number): void {
    this.engineStats.pageCount = count;
  }

  /** Take a full metrics snapshot. Synchronous. */
  snapshot(): MetricsSnapshot {
    const now = Date.now();
    const uptimeSeconds = Math.floor((now - this.startTime) / 1000);

    // Top routes sorted by request count descending, capped at 10.
    const topRoutes = Array.from(this.routeMap.values())
      .sort((a, b) => b.requests - a.requests)
      .slice(0, 10)
      .map((rm) => ({
        route: rm.route,
        requests: rm.requests,
        errors: rm.errors,
        latency: computeStats(rm.latency),
      }));

    // Page cache stats.
    let pageCache: MetricsSnapshot["pageCache"] = null;
    if (this.pageCacheRef) {
      const raw = this.pageCacheRef();
      if (raw) {
        pageCache = {
          entries: raw.entries,
          hits: raw.hits,
          misses: raw.misses,
          hitRate: raw.hitRate ?? 0,
          evictions: raw.evictions,
        };
      }
    }

    // Memory.
    const mem = Deno.memoryUsage();

    return {
      ts: new Date(now).toISOString(),
      uptimeSeconds,
      requests: {
        total: this.totalRequests,
        errors: this.totalErrors,
        errorRate: this.totalRequests > 0
          ? this.totalErrors / this.totalRequests
          : 0,
        latency: computeStats(this.globalLatency),
      },
      topRoutes,
      pageCache,
      memory: {
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        rss: mem.rss,
        external: mem.external,
      },
      engine: { ...this.engineStats },
      slowQueries: [...this.slowQueryList],
    };
  }
}
