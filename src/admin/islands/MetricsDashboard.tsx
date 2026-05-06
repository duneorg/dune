/** @jsxImportSource preact */
/**
 * Island: performance metrics dashboard — request latency percentiles,
 * error rates, memory, and slow queries. Auto-refreshes every 30s.
 * Talks to /admin/api/metrics.
 */

import { h, Fragment } from "preact";
import { useState, useEffect, useCallback } from "preact/hooks";

interface LatencyPercentiles {
  p50: number;
  p75: number;
  p95: number;
  p99: number;
}

interface MetricsSummary {
  requestCount: number;
  errorCount: number;
  errorRate: number;
  latency: LatencyPercentiles;
  slowQueries: Array<{ route: string; avgMs: number; count: number }>;
  memory: { heapUsed: number; heapTotal: number; rss: number };
  uptime: number;
  windowSeconds: number;
}

interface Props {
  prefix: string;
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function fmtUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export default function MetricsDashboard({ prefix }: Props) {
  const apiBase = `${prefix}/api`;

  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<MetricsSummary | null>(null);
  const [error, setError] = useState("");
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/metrics`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json() as MetricsSummary;
      setMetrics(d);
      setLastRefresh(new Date());
      setError("");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(load, 30_000);
    return () => clearInterval(timer);
  }, [autoRefresh, load]);

  if (loading) return <div style="padding:2rem;color:#718096">Loading metrics…</div>;

  return (
    <div class="metrics-wrap">
      {/* Toolbar */}
      <div style="display:flex;align-items:center;gap:1rem;margin-bottom:1.5rem">
        <button class="btn btn-sm btn-outline" onClick={load}>↻ Refresh</button>
        <label style="display:flex;align-items:center;gap:0.5rem;font-size:0.9rem">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh((e.target as HTMLInputElement).checked)}
          />
          Auto-refresh (30s)
        </label>
        {lastRefresh && (
          <span style="color:#718096;font-size:0.85rem;margin-left:auto">
            Last updated: {lastRefresh.toLocaleTimeString()}
          </span>
        )}
      </div>

      {error && <div class="alert alert-error" style="margin-bottom:1rem">{error}</div>}

      {metrics && (
        <>
          {/* Summary cards */}
          <div class="metrics-cards" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:1rem;margin-bottom:2rem">
            <MetricCard label="Requests" value={String(metrics.requestCount)} sub={`${metrics.windowSeconds}s window`} />
            <MetricCard
              label="Error rate"
              value={`${(metrics.errorRate * 100).toFixed(1)}%`}
              sub={`${metrics.errorCount} errors`}
              highlight={metrics.errorRate > 0.05}
            />
            <MetricCard label="p50 latency" value={fmtMs(metrics.latency.p50)} />
            <MetricCard label="p95 latency" value={fmtMs(metrics.latency.p95)} highlight={metrics.latency.p95 > 1000} />
            <MetricCard label="p99 latency" value={fmtMs(metrics.latency.p99)} highlight={metrics.latency.p99 > 2000} />
            <MetricCard label="Heap used" value={fmtBytes(metrics.memory.heapUsed)} sub={`of ${fmtBytes(metrics.memory.heapTotal)}`} />
            <MetricCard label="RSS" value={fmtBytes(metrics.memory.rss)} />
            <MetricCard label="Uptime" value={fmtUptime(metrics.uptime)} />
          </div>

          {/* Latency bar chart */}
          <div style="margin-bottom:2rem">
            <h4>Latency distribution</h4>
            <div style="display:flex;flex-direction:column;gap:0.5rem;max-width:480px">
              {[
                { label: "p50", value: metrics.latency.p50 },
                { label: "p75", value: metrics.latency.p75 },
                { label: "p95", value: metrics.latency.p95 },
                { label: "p99", value: metrics.latency.p99 },
              ].map(({ label, value }) => {
                const maxMs = Math.max(metrics.latency.p99, 100);
                const pct = Math.min(100, (value / maxMs) * 100);
                return (
                  <div key={label} style="display:flex;align-items:center;gap:0.75rem">
                    <span style="width:3rem;font-size:0.85rem;color:#718096">{label}</span>
                    <div style={`flex:1;height:8px;background:#e2e8f0;border-radius:4px`}>
                      <div
                        style={`height:8px;width:${pct}%;background:${value > 1000 ? "#e53e3e" : value > 500 ? "#f59e0b" : "#4f46e5"};border-radius:4px`}
                      />
                    </div>
                    <span style="width:4rem;font-size:0.85rem;text-align:right">{fmtMs(value)}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Slow queries */}
          {metrics.slowQueries.length > 0 && (
            <div>
              <h4>Slowest routes</h4>
              <table class="admin-table" style="max-width:640px">
                <thead>
                  <tr>
                    <th>Route</th>
                    <th>Avg</th>
                    <th>Requests</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.slowQueries.map((q, i) => (
                    <tr key={i}>
                      <td><code>{q.route}</code></td>
                      <td style={q.avgMs > 1000 ? "color:#e53e3e" : ""}>{fmtMs(q.avgMs)}</td>
                      <td>{q.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div
      style={`border:1px solid ${highlight ? "#fed7d7" : "#e2e8f0"};border-radius:8px;padding:1rem;background:${highlight ? "#fff5f5" : "white"}`}
    >
      <div style="font-size:0.8rem;color:#718096;margin-bottom:0.25rem">{label}</div>
      <div style={`font-size:1.5rem;font-weight:700;color:${highlight ? "#e53e3e" : "#2d3748"}`}>{value}</div>
      {sub && <div style="font-size:0.8rem;color:#a0aec0;margin-top:0.25rem">{sub}</div>}
    </div>
  );
}
