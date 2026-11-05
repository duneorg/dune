/**
 * System-level configuration types: engine behaviour, theming,
 * multi-site, and shared inspector types.
 */

import type { IncomingWebhookConfig } from "./forms-config.ts";

/** System-level configuration (engine behavior) */
export interface SystemConfig {
  content: {
    dir: string;
    /**
     * When set, content is loaded from this path instead of `{dir}` under
     * the site root. Local path only (`./`, `../`, or absolute) — same
     * semantics as `theme.src`. Gets its own contained storage root; the
     * site's own storage boundary is never widened.
     */
    src?: string;
    markdown: {
      extra: boolean;
      auto_links: boolean;
      auto_url_links: boolean;
    };
    /**
     * Roles permitted to create or save pages with `format: tsx`.
     * TSX pages execute arbitrary Deno code during SSR and must be treated
     * as equivalent to server shell access. Default: `["admin"]`.
     * Set to `[]` to disable TSX content entirely.
     */
    allow_tsx_format?: string[];
  };
  cache: {
    enabled: boolean;
    driver: "memory" | "filesystem" | "kv";
    lifetime: number;
    check: "file" | "hash" | "none";
  };
  images: {
    default_quality: number;
    cache_dir: string;
    allowed_sizes: number[];
  };
  languages: {
    supported: string[];
    default: string;
    include_default_in_url: boolean;
    /**
     * Additional language codes to treat as RTL (right-to-left).
     * Extends the built-in RTL language list (`ar`, `he`, `fa`, `ur`, …).
     * Use this for rare scripts or when you need to force a code to RTL.
     * @example ["ku-Latn"] — mark Kurmanji Kurdish in Latin script as RTL
     */
    rtl_override?: string[];
  };
  /** Typography options (orphan protection, etc.) */
  typography?: {
    /** Insert &nbsp; before last word of paragraphs to avoid orphans (default: true) */
    orphan_protection?: boolean;
  };
  /**
   * In-process rendered HTML page cache (server mode only).
   * Caches the rendered HTML for each route in memory with a TTL.
   * Reduces CPU load at the cost of serving slightly stale content
   * for at most `ttl` seconds after a page edit.
   */
  page_cache?: {
    /** Enable the in-process cache (default: false). */
    enabled?: boolean;
    /**
     * Maximum number of HTML entries to keep in memory.
     * When full, the oldest-inserted entry is evicted.
     * Default: 500
     */
    max_entries?: number;
    /**
     * Entry time-to-live in seconds.
     * After `ttl` seconds the entry is considered stale and re-rendered.
     * Default: 30
     */
    ttl?: number;
    /**
     * Pre-render all pages in the background after server startup to
     * populate the cache before the first real request arrives.
     * Default: false
     */
    warm?: boolean;
  };
  /**
   * Runtime feature flags — toggle features without code changes.
   *
   * Values can be:
   *   - `true` / `false` — static toggle
   *   - `"env:VAR_NAME"` — read from environment variable at startup
   *     (truthy when the var is set to "1", "true", or "yes")
   *
   * @example
   * ```yaml
   * flags:
   *   comments: true
   *   new_editor: false
   *   beta_search: env:ENABLE_BETA_SEARCH
   * ```
   *
   * Read flags with the `flag()` helper:
   * ```ts
   * import { flag } from "@dune/core";
   * if (flag("comments")) { ... }
   * ```
   */
  flags?: Record<string, boolean | string>;
  /** Full-text search configuration. */
  search?: {
    /**
     * Stop startup when any search engine fails to build. By default a failed
     * engine is logged, retried in the background, and search falls back to
     * the built-in engine (or answers 503 if nothing can serve it) while the
     * site keeps serving content. Set this to let a failed health check on
     * the new instance block a deploy instead.
     * Default: false.
     */
    fail_on_startup?: boolean;
    /**
     * Count `GET /api/search` queries (the query text and its result count,
     * no IP or user data) in `{admin.runtime_dir}/search-analytics.json` so
     * editors can see top queries and zero-result queries. It keeps counters
     * for at most 2000 distinct queries, not a request log, so it stays small
     * whatever the traffic. The file holds what visitors typed, so it is off
     * unless you turn it on.
     * Default: false.
     */
    analytics?: boolean;
    /**
     * Additional frontmatter field names to include in the full-text index.
     * By default only title, body, and taxonomy values are indexed.
     * Add field names here to make custom frontmatter searchable.
     * @example ["summary", "tags", "author"]
     */
    custom_fields?: string[];
    /** Per-field relevance weights. Higher = more important. Default weight: 1. */
    fields?: {
      title?: { weight: number };
      summary?: { weight: number };
      body?: { weight: number };
      [field: string]: { weight: number } | undefined;
    };
    /**
     * Flex Object type names to include in the search index.
     * Records from these types are indexed alongside content pages.
     * @example ["posts", "events"]
     */
    include_flex?: string[];
    /** Facet definitions for filtering search results. */
    facets?: Array<{
      /** Dot-path into frontmatter, e.g. "taxonomy.category" or "template" */
      field: string;
    }>;
    /** Return highlighted excerpts with match terms wrapped in <mark>. Default: true */
    highlight?: boolean;
    /** Character length of returned excerpts. Default: 160 */
    excerpt_length?: number;
    /**
     * Default number of results returned per page by /api/search and the
     * SSR /search route when the request doesn't specify `limit`, applying
     * identically to both once set. When unset, /api/search falls back to
     * 20 and the SSR /search route falls back to 50 (its original default,
     * since a rendered results page has room for more per screen). A
     * client-supplied `limit` query param still overrides this per request.
     */
    page_size?: number;
  };
  /**
   * Session persistence backend.
   * Defaults to "local" (file-backed, single-process). Use "kv" for Deno Deploy
   * or multi-isolate environments, and "redis" for traditional multi-process
   * deployments behind a load balancer.
   *
   * @example
   * ```yaml
   * system:
   *   session_store:
   *     type: kv
   * ```
   *
   * @example Redis
   * ```yaml
   * system:
   *   session_store:
   *     type: redis
   *     url: "$REDIS_URL"
   * ```
   */
  session_store?: {
    /**
     * Backend type:
     *   "local" — file-backed via StorageAdapter (default)
     *   "kv"    — Deno KV (auto-selected on Deno Deploy)
     *   "redis" — Redis via ioredis (requires url)
     */
    type?: "local" | "kv" | "redis";
    /**
     * Redis connection URL. Required when type === "redis".
     * Supports "$ENV_VAR" expansion.
     * @example "redis://localhost:6379"
     */
    url?: string;
    /**
     * Key namespace for the "redis" and "kv" backends: 1-64 characters from
     * `A-Za-z0-9_.:-`. Sites that share one Redis (or one KV database) share
     * sessions unless their prefixes differ. In multisite it defaults to
     * `dune:<site id>`; single-site installs default to the original unprefixed
     * keys. Setting it changes the keys, so existing sessions are signed out.
     */
    prefix?: string;
  };
  /** Performance metrics collection settings. */
  metrics?: {
    /**
     * Enable the in-process metrics collector (default: true).
     */
    enabled?: boolean;
    /**
     * Slow query threshold in milliseconds (default: 100).
     * Collection and search queries exceeding this are logged.
     */
    slow_query_threshold_ms?: number;
  };
  /**
   * Structured logging configuration.
   */
  logging?: {
    /**
     * Log output format.
     * "text" — human-readable with ANSI colours (default in dev)
     * "json" — NDJSON one-object-per-line (default in prod / Deno Deploy)
     */
    format?: "text" | "json";
    /**
     * Minimum log level to emit.
     * Lines below this level are suppressed.
     * Default: "info"
     */
    level?: "debug" | "info" | "warn" | "error";
  };
  debug: boolean;
  timezone: string;
  /**
   * Trust the X-Forwarded-For / X-Real-IP request headers when extracting
   * the client IP for rate limiting, account lockout, and audit logging.
   * Only enable this when the deployment terminates TLS at a known reverse
   * proxy (Caddy, nginx, Cloudflare, etc.) that overwrites these headers
   * before forwarding. With direct internet exposure, leave it false (the
   * default) — otherwise any client can send their own forwarded header
   * and bypass per-IP rate limits or evade lockout. When false, `clientIp()`
   * uses the TCP peer stamped at `Deno.serve` instead.
   *
   * @since 1.0.0
   */
  trusted_proxies?: boolean;
  /**
   * Persistent data directory (git-tracked, user-authored records): form
   * submissions and, with the admin plugin, its users. Default: "data".
   * Replaces `admin.dataDir`.
   */
  data_dir?: string;
  /**
   * Webhooks. `incoming` lets external systems trigger actions by POSTing to
   * `/api/webhook/incoming` with a token, no admin plugin needed.
   *
   * @example
   * ```yaml
   * webhooks:
   *   incoming:
   *     - token: "$DEPLOY_WEBHOOK_TOKEN"
   *       actions: [rebuild]
   * ```
   */
  webhooks?: {
    incoming?: IncomingWebhookConfig[];
  };
  /**
   * Distributed tracing configuration (OpenTelemetry-compatible).
   * When enabled, the engine wraps key operations in spans and optionally
   * exports them to an OTLP/HTTP collector.
   *
   * @example Jaeger via OTLP/HTTP
   * ```yaml
   * system:
   *   tracing:
   *     enabled: true
   *     endpoint: http://localhost:4318/v1/traces
   *     service_name: my-dune-site
   * ```
   */
  tracing?: {
    /**
     * Enable distributed tracing (default: false).
     * When false, a no-op tracer is used — zero runtime overhead.
     */
    enabled?: boolean;
    /**
     * OTLP/HTTP collector endpoint.
     * When omitted, spans are only emitted as debug log lines.
     * @example "http://localhost:4318/v1/traces"
     */
    endpoint?: string;
    /**
     * Service name attached to every span as the `service.name` resource attribute.
     * Defaults to "dune".
     */
    service_name?: string;
  };
  /**
   * Optional token gating the detailed `/health?detailed=true` response.
   *
   * When unset, /health always returns `{ "status": "ok" }` regardless of
   * query parameters — the operator-friendly metrics (uptime, page count,
   * cache stats) are not exposed publicly because they're useful for
   * fingerprinting and DoS amplification.
   *
   * When set, callers can request the detailed body by passing the token:
   *     GET /health?detailed=true&token=<value>
   * Mismatched or missing tokens still get the minimal `{ status: "ok" }`
   * response.
   *
   * Refs: claudedocs/security-audit-2026-05.md LOW-3 (CWE-200).
   *
   * @since 1.0.0
   */
  health_token?: string;
}

/** Theme configuration */
export interface ThemeConfig {
  /** Active theme name (local folder and/or registered package name). */
  name: string;
  /**
   * When set, the active theme is loaded from this package instead of
   * `themes/{name}/`. Must be version-pinned (jsr:/npm:).
   */
  src?: string;
  /**
   * Parent theme for inheritance — local name, import-map alias, or pinned
   * jsr:/npm: specifier. Overrides `parent` in the active theme's theme.yaml.
   */
  parent?: string;
  custom: Record<string, unknown>;
}

/** Source annotation for config inspector */
export interface ConfigSource {
  value: unknown;
  source: string; // e.g., "config/site.yaml:3" or "default"
}

// ── Multi-site ───────────────────────────────────────────────────────────────

/**
 * One site entry in `config/sites.yaml`.
 * A single Dune installation can serve multiple independent sites.
 */
export interface SiteEntry {
  /** Unique identifier used in logs and cross-site collection queries */
  id: string;
  /**
   * Path to the site root directory.
   * Resolved relative to the directory containing `config/sites.yaml`.
   * Stored as an absolute path after loading.
   */
  root: string;
  /**
   * Hostname-based routing: requests whose `Host` header equals this value
   * are dispatched to this site (e.g. `"example.com"`).
   * Mutually exclusive with `pathPrefix`.
   */
  hostname?: string;
  /**
   * Path-prefix-based routing: requests whose pathname starts with this
   * prefix are dispatched to this site (e.g. `"/docs"`).
   * The prefix is stripped from the request URL before forwarding.
   * Mutually exclusive with `hostname`.
   */
  pathPrefix?: string;
  /**
   * Catch-all fallback site.
   * Receives requests that match no other entry.
   * If none is marked default, the first entry is used.
   */
  default?: boolean;
}

/**
 * Top-level structure of `config/sites.yaml`.
 * Present only when running in multi-site mode.
 */
export interface MultisiteConfig {
  sites: SiteEntry[];
  /**
   * Absolute path to a shared themes directory.
   * Sites check their own `themes/` first, then this directory.
   * @example "./shared/themes"
   */
  sharedThemesDir?: string;
  /**
   * Absolute path to a shared plugins directory (informational).
   * Sites reference shared plugins via relative paths in their `site.yaml`.
   * @example "./shared/plugins"
   */
  sharedPluginsDir?: string;
}
