---
title: "HTTP Caching"
published: true
visible: true
taxonomy:
  audience: [webmaster, developer]
  difficulty: [intermediate]
  topic: [deployment, performance, caching]
metadata:
  description: "Configure HTTP cache headers, ETag/304 support, stale-while-revalidate, and the in-process page cache"
---

# HTTP Caching

Dune ships with three complementary caching mechanisms:

| Mechanism | Where it lives | What it does |
|-----------|----------------|--------------|
| **ETag / 304** | HTTP headers | Lets browsers and CDNs validate cached copies without a full re-download |
| **Cache-Control + SWR** | HTTP headers | Tells CDNs how long to cache and how to serve stale content while revalidating |
| **In-process page cache** | Server memory | Avoids re-rendering popular pages on every request |

All three are enabled by default with conservative settings and work without any configuration changes.

---

## ETag and 304 Not Modified

Dune automatically adds an `ETag` header to every rendered content page. The ETag is derived from the page's route, title, date, template, and format — no file I/O required.

On subsequent requests that include `If-None-Match: "<etag>"`, Dune returns `304 Not Modified` with an empty body. Browsers and CDNs use this to confirm their cached copy is still valid without transferring the full HTML again.

This works automatically with no configuration.

---

## Cache-Control headers

### Defaults

Rendered HTML pages receive:

```
Cache-Control: public, max-age=0, stale-while-revalidate=60
```

This means:
- Browsers must revalidate every time (via ETag/304 — almost always instant).
- CDNs and shared caches may serve a stale copy for up to 60 seconds while fetching a fresh one in the background.

Static assets (fonts, images, CSS, JS) keep their existing long-lived headers (`max-age=31536000`).

### Configuring the default

```yaml
# site.yaml
http_cache:
  default_max_age: 300        # 5 min browser cache
  default_swr: 3600           # 1 h CDN stale-while-revalidate
```

### Per-route rules

Override the default for specific URL prefixes. The **longest matching prefix** wins; exact matches take priority over prefixes.

```yaml
# site.yaml
http_cache:
  default_max_age: 0
  default_swr: 60
  rules:
    # Long-lived blog posts
    - pattern: "/blog"
      max_age: 3600
      stale_while_revalidate: 86400

    # Never cache the search page
    - pattern: "/search"
      no_store: true

    # Docs can be cached aggressively
    - pattern: "/docs"
      max_age: 86400
      stale_while_revalidate: 604800
```

| Field | Type | Description |
|-------|------|-------------|
| `pattern` | `string` | URL prefix or exact path |
| `max_age` | `number` | Browser max-age in seconds |
| `stale_while_revalidate` | `number` | CDN/shared-cache SWR in seconds |
| `no_store` | `boolean` | Emit `Cache-Control: no-store` (disables all caching) |

---

## In-process page cache

For high-traffic deployments, Dune can cache rendered HTML in server memory so popular pages don't get re-rendered on every request.

```yaml
# system.yaml
page_cache:
  enabled: true
  max_entries: 500       # max pages held in memory
  ttl: 30                # seconds before an entry is considered stale
  warm: true             # pre-load all pages at startup
```

### How it works

1. On the first request to a page, Dune renders the HTML and stores it with its ETag.
2. Subsequent requests within `ttl` seconds return the cached HTML directly — no template rendering.
3. After `ttl` seconds the entry expires; the next request re-renders and refreshes the cache.
4. If the page's ETag is still current, a `304` is returned instead of the full HTML regardless of the cache.

### Cache warming

Set `warm: true` to pre-resolve all published pages in the background immediately after server startup. This avoids cold-start latency on the first request to each page after a restart.

Warming is fire-and-forget — the server starts accepting requests immediately; warming happens concurrently.

### Tuning

| Setting | Default | Notes |
|---------|---------|-------|
| `max_entries` | `500` | Each entry holds a rendered HTML string. A typical page is 10–50 KB; 500 entries ≈ 5–25 MB. |
| `ttl` | `30` | Shorter = fresher content, more CPU. Longer = faster responses, potentially stale for longer after edits. |

### Monitoring

The `/health` endpoint includes cache statistics when the page cache is enabled:

```json
{
  "status": "ok",
  "uptime": 3600,
  "pages": 124,
  "cache": {
    "entries": 87,
    "hits": 14203,
    "misses": 211,
    "hitRate": 0.985,
    "evictions": 0
  }
}
```

---

## Recommended configurations

### Small to medium sites (default)

No configuration needed. ETag/304 validation and a 60-second SWR window work well out of the box.

### High-traffic server deployment

```yaml
# system.yaml
page_cache:
  enabled: true
  max_entries: 1000
  ttl: 60
  warm: true
```

```yaml
# site.yaml
http_cache:
  default_max_age: 0
  default_swr: 300
```

### CDN-fronted deployment (Cloudflare, Fastly, CloudFront)

```yaml
# site.yaml
http_cache:
  default_max_age: 0         # browser always revalidates via ETag
  default_swr: 3600          # CDN serves stale for 1 h while revalidating
  rules:
    - pattern: "/blog"
      max_age: 0
      stale_while_revalidate: 86400
    - pattern: "/docs"
      max_age: 3600
      stale_while_revalidate: 604800
    - pattern: "/api"
      no_store: true
```

### Static site

For `dune build --static` output, caching is handled entirely by the static host. HTTP caching config has no effect in static builds.
