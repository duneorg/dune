---
title: "Performance Monitoring"
published: true
visible: true
taxonomy:
  audience: [webmaster, developer]
  difficulty: [intermediate]
  topic: [administration, performance]
metadata:
  description: "Monitor request latency, page render times, memory usage, and slow queries from the admin dashboard"
---

# Performance Monitoring

Dune's built-in performance monitor gives you operational visibility into your running server — request latency percentiles, memory usage, cache hit rates, and slow queries — without any external services or agents.

All data is in-process and resets on server restart. This is an operational tool, not long-term analytics.

---

## Dashboard

Navigate to **Admin → Performance** to see the live dashboard (refreshes every 30 seconds).

The dashboard shows:

- **Uptime** — how long the server has been running
- **Request stats** — total requests, error rate, p50/p95/p99 latency
- **Memory usage** — heap used/total and RSS in MB
- **Engine stats** — indexed page count, rebuild count, last rebuild time
- **Page cache stats** — entries, hit rate, eviction count (when page cache is enabled)
- **Top routes** — the 10 most-requested URLs with per-route latency
- **Slow queries** — last 20 collection or search queries that exceeded the threshold

---

## REST API

```
GET /admin/api/metrics
```

Requires admin role. Returns a full metrics snapshot as JSON.

### Example response

```json
{
  "ts": "2026-03-28T15:04:11.000Z",
  "uptimeSeconds": 3820,
  "requests": {
    "total": 15420,
    "errors": 12,
    "errorRate": 0.00078,
    "latency": {
      "count": 15420,
      "p50": 4.2,
      "p95": 18.7,
      "p99": 42.1,
      "max": 310.5,
      "mean": 6.1
    }
  },
  "topRoutes": [
    {
      "route": "/blog",
      "requests": 4201,
      "errors": 0,
      "latency": { "count": 4201, "p50": 3.1, "p95": 11.2, "p99": 24.8, "max": 87.3, "mean": 4.4 }
    }
  ],
  "pageCache": {
    "entries": 87,
    "hits": 14203,
    "misses": 211,
    "hitRate": 0.985,
    "evictions": 0
  },
  "memory": {
    "heapUsed": 48234496,
    "heapTotal": 67108864,
    "rss": 112345088,
    "external": 2048000
  },
  "engine": {
    "pageCount": 124,
    "rebuildCount": 3,
    "lastRebuildMs": 0
  },
  "slowQueries": [
    {
      "ts": "2026-03-28T14:58:22.100Z",
      "type": "collection",
      "query": "all published pages in /blog",
      "durationMs": 143
    }
  ]
}
```

---

## Configuration

```yaml
# system.yaml
metrics:
  enabled: true                # boolean — Enable metrics collector (default: true)
  slowQueryThresholdMs: 100    # number  — Log queries taking longer than this (default: 100)
```

To disable metrics collection entirely:

```yaml
metrics:
  enabled: false
```

---

## Latency percentiles

Latency is tracked using a fixed-size circular buffer (1,000 samples per route). When the buffer fills, the oldest sample is overwritten. Percentiles are computed from the current window on each snapshot request.

**Reading the numbers:**

- **p50** — half of requests complete faster than this
- **p95** — 95% of requests complete faster than this (a good general health indicator)
- **p99** — 99% of requests complete faster than this (highlights outliers)

All latency values are in **milliseconds**.

---

## Slow queries

Collection and search queries that exceed `slowQueryThresholdMs` are recorded. The last 20 are retained in memory and shown on the dashboard and in the API response.

If you see frequent slow queries, consider:
- Enabling the [in-process page cache](/deployment/caching) to reduce re-rendering
- Narrowing collection queries (add `filter` criteria, reduce `limit`)
- Checking for large content directories with many files

---

## Notes

- Metrics are in-process only — no files are written, no external services called
- Data resets on server restart
- `GET /admin/api/metrics` and the dashboard require **admin role**
- Metrics have no effect in `dune build --static` mode (no server to monitor)
