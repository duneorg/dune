/**
 * Type definitions for the in-process performance metrics system.
 */

/** A fixed-size circular buffer of numbers for latency tracking */
export interface LatencySample {
  values: Float64Array;
  head: number;   // next write position
  size: number;   // number of valid entries
  capacity: number;
}

/** Aggregated latency stats */
export interface LatencyStats {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
}

/** Per-route request metrics */
export interface RouteMetrics {
  route: string;
  requests: number;
  errors: number;
  /** Latency samples in ms */
  latency: LatencySample;
}

/** Slow query record */
export interface SlowQuery {
  ts: string;       // ISO
  type: "collection" | "search";
  query: string;    // description or source
  durationMs: number;
}

/** Full metrics snapshot — returned by MetricsCollector.snapshot() */
export interface MetricsSnapshot {
  ts: string;                  // ISO timestamp of snapshot
  uptimeSeconds: number;
  requests: {
    total: number;
    errors: number;
    errorRate: number;         // 0-1
    latency: LatencyStats;     // across all routes
  };
  topRoutes: Array<{
    route: string;
    requests: number;
    errors: number;
    latency: LatencyStats;
  }>;
  pageCache: {
    entries: number;
    hits: number;
    misses: number;
    hitRate: number;
    evictions: number;
  } | null;
  memory: {
    heapUsed: number;      // bytes
    heapTotal: number;
    rss: number;
    external: number;
  };
  engine: {
    pageCount: number;
    rebuildCount: number;
    lastRebuildMs: number | null;
  };
  slowQueries: SlowQuery[];  // last 20
}

/** Options for MetricsCollector */
export interface MetricsOptions {
  /** Max samples per route latency buffer (default: 1000) */
  sampleCapacity?: number;
  /** Slow query threshold in ms (default: 100) */
  slowQueryThresholdMs?: number;
  /** Max slow query entries to retain (default: 20) */
  maxSlowQueries?: number;
}
