/**
 * Performance metrics — public API.
 *
 * @module
 */

export { MetricsCollector } from "./collector.ts";
export type {
  LatencySample,
  LatencyStats,
  MetricsOptions,
  MetricsSnapshot,
  RouteMetrics,
  SlowQuery,
} from "./types.ts";
