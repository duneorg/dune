/**
 * Configuration type definitions for Dune CMS.
 */

import type { WorkflowStage, WorkflowTransition } from "../workflow/types.ts";
import type { MachineTranslationConfig } from "../mt/types.ts";

/**
 * A single plugin entry declared in site.yaml under the `plugins:` key.
 *
 * @example Local plugin
 * ```yaml
 * plugins:
 *   - src: "./plugins/my-plugin.ts"
 * ```
 *
 * @example JSR plugin with config
 * ```yaml
 * plugins:
 *   - src: "jsr:@dune/plugin-seo"
 *     config:
 *       defaultDescription: "My site"
 * ```
 */
export interface PluginEntry {
  /**
   * Module source — local path or registry specifier.
   *
   * Supported forms:
   *   - `"./plugins/my-plugin.ts"` — relative to site root
   *   - `"jsr:@scope/plugin-name"` — JSR package
   *   - `"npm:dune-plugin-name"` — npm package (via Deno's npm: specifier)
   *   - `"https://example.com/plugin.ts"` — remote URL
   */
  src: string;
  /**
   * Static config for this plugin.
   * Merged into DuneConfig.plugins[plugin.name] and readable by the plugin
   * via ctx.config.plugins[name] inside hook handlers.
   */
  config?: Record<string, unknown>;
}

/** Top-level Dune configuration (result of merging all config sources) */
export interface DuneConfig {
  site: SiteConfig;
  system: SystemConfig;
  theme: ThemeConfig;
  /**
   * Plugin runtime configs — keyed by plugin name.
   * Populated from PluginEntry.config declarations at load time, then
   * overridable via the admin config form for plugins with a configSchema.
   */
  plugins: Record<string, Record<string, unknown>>;
  /**
   * Ordered list of plugins to load.
   * Declared in site.yaml under the `plugins:` key.
   */
  pluginList: PluginEntry[];
  /** Admin panel configuration (optional — defaults applied if omitted) */
  admin?: AdminConfig;
}

/** Admin panel configuration */
export interface AdminConfig {
  /** Admin panel route prefix (default: "/admin") */
  path: string;
  /** Session lifetime in seconds (default: 86400 = 24h) */
  sessionLifetime: number;
  /**
   * Persistent data directory — git-tracked, user-authored records.
   * Stores: admin users, form submissions.
   * (default: "data")
   */
  dataDir: string;
  /**
   * Runtime directory — ephemeral, machine-local, gitignored.
   * Stores: sessions, scheduled actions, revision history, workflow state.
   * (default: ".dune/admin")
   */
  runtimeDir: string;
  /** Whether admin panel is enabled (default: true) */
  enabled: boolean;
  /**
   * Maximum number of revisions to retain per page (default: 50).
   * When the limit is reached, the oldest revision is pruned on each save.
   */
  maxRevisions?: number;
  /**
   * Honeypot field name for form spam protection.
   * If this field is present and non-empty in a submission, the submission
   * is silently discarded (bots fill hidden fields; humans leave them empty).
   * Default: "_hp"
   */
  honeypot?: string;
  /** Outbound notifications fired after each form submission is saved. */
  notifications?: AdminNotificationsConfig;
  /**
   * Automatically create a git commit after every page save via the admin panel.
   * Requires the site directory to be a git repository.
   * Commit message: "Admin: update {sourcePath}"
   * Default: false
   */
  git_commit?: boolean;
  /**
   * Outbound webhook endpoints fired on content mutation events
   * (page create, update, delete, workflow state change).
   * Multiple endpoints can be configured; each has independent event filtering.
   */
  webhooks?: WebhookEndpointConfig[];
  /**
   * Incoming webhook tokens — allow external systems to trigger actions
   * (e.g. rebuild, cache purge) by POSTing to POST /api/webhook/incoming.
   *
   * @example
   * ```yaml
   * admin:
   *   incoming_webhooks:
   *     - token: "$DEPLOY_WEBHOOK_TOKEN"
   *       actions: [rebuild]
   *     - token: "$CACHE_WEBHOOK_TOKEN"
   *       actions: [purge-cache]
   * ```
   */
  incoming_webhooks?: Array<{
    /** Secret token — supports "$ENV_VAR" expansion */
    token: string;
    /** Permitted actions for this token */
    actions: Array<"rebuild" | "purge-cache">;
  }>;
  /**
   * Audit log configuration.
   * Records admin panel actions with actor, timestamp, IP, and outcome.
   */
  audit?: {
    /**
     * Enable audit logging (default: true).
     */
    enabled?: boolean;
    /**
     * Path to the JSONL audit log file.
     * Relative to runtimeDir, or absolute.
     * Default: "{runtimeDir}/audit.log"
     */
    logFile?: string;
  };
}

/** Notifications sent after a form submission is accepted. */
export interface AdminNotificationsConfig {
  /** Send an email for every new submission. */
  email?: SmtpNotificationConfig;
  /** POST submission JSON to a webhook URL for every new submission. */
  webhook?: WebhookNotificationConfig;
}

/**
 * SMTP-based email notification.
 *
 * String values that start with "$" are treated as environment variable names
 * and expanded at runtime:  pass: "$SMTP_PASSWORD"  →  Deno.env.get("SMTP_PASSWORD")
 */
export interface SmtpNotificationConfig {
  smtp: {
    host: string;
    port: number;
    /** true = implicit TLS on port 465; false = STARTTLS on port 587 (default) */
    secure: boolean;
    user: string;
    /** Supports "$ENV_VAR" expansion */
    pass: string;
  };
  /** RFC 5321 envelope from address, e.g. "Dune CMS <noreply@example.com>" */
  from: string;
  /** Recipient address(es) */
  to: string | string[];
  /**
   * Email subject.  Supports {form} placeholder.
   * Default: "New {form} submission"
   */
  subject?: string;
}

/** HTTP webhook notification. */
export interface WebhookNotificationConfig {
  /** URL to POST the submission JSON to. */
  url: string;
  /**
   * Optional secret used to sign the request body.
   * Adds X-Dune-Signature: sha256=<hex> header so the receiver can verify authenticity.
   * Supports "$ENV_VAR" expansion.
   */
  secret?: string;
}

/**
 * Content event types that can trigger outbound webhooks.
 * Each corresponds to a hook fired by the admin panel after a CRUD operation.
 */
export type WebhookContentEvent =
  | "onPageCreate"
  | "onPageUpdate"
  | "onPageDelete"
  | "onWorkflowChange";

/**
 * A single outbound webhook endpoint configuration.
 * Multiple endpoints can be configured under `admin.webhooks`.
 */
export interface WebhookEndpointConfig {
  /** URL to POST the event payload to. */
  url: string;
  /**
   * Secret used to sign the request body (HMAC-SHA256).
   * Adds X-Dune-Signature: sha256=<hex> header.
   * Supports "$ENV_VAR" expansion.
   */
  secret?: string;
  /**
   * Which content events should trigger this endpoint.
   * @example ["onPageCreate", "onPageUpdate"]
   */
  events: WebhookContentEvent[];
  /** Whether this endpoint is active (default: true). */
  enabled?: boolean;
  /** Optional human-readable label shown in delivery logs. */
  label?: string;
}

/**
 * A per-route HTTP cache rule.
 * Imported here to keep the config schema self-contained.
 * See src/cache/policy.ts for resolution logic.
 */
export interface HttpCacheRule {
  pattern: string;
  max_age?: number;
  stale_while_revalidate?: number;
  no_store?: boolean;
}

/** Site-level configuration (content, identity, metadata) */
export interface SiteConfig {
  title: string;
  description: string;
  url: string;
  author: {
    name: string;
    email?: string;
  };
  /** Folder slug or route that serves as homepage. Autodetected if omitted.
   * When omitted, the first ordered top-level folder (lowest numeric prefix) is used.
   * @example "home" | "efficiency" | "landing"
   */
  home?: string;
  metadata: Record<string, string>;
  /** Taxonomy types enabled for this site */
  taxonomies: string[];
  /** Route aliases: { "/old": "/new" } */
  routes: Record<string, string>;
  /** Redirects: { "/old": "/new" } (301 by default) */
  redirects: Record<string, string>;
  /**
   * Additional origins allowed to make cross-origin API requests.
   * The origin derived from `site.url` is always allowed.
   * Add extra origins here for headless/decoupled frontends on different domains.
   * @example ["https://app.example.com", "https://staging.example.com"]
   */
  cors_origins?: string[];
  /**
   * RSS / Atom feed generation settings.
   * Feeds are served at /feed.xml (RSS 2.0) and /atom.xml (Atom 1.0).
   */
  feed?: {
    /** Whether to generate feeds (default: true) */
    enabled?: boolean;
    /** Number of items per feed, newest-first (default: 20) */
    items?: number;
    /**
     * Item body content mode:
     *   "summary" — auto-generated excerpt (default, faster, smaller payload)
     *   "full"    — fully rendered HTML content
     */
    content?: "summary" | "full";
  };
  /**
   * HTTP response caching settings for served content.
   * Controls Cache-Control headers on rendered HTML pages.
   */
  http_cache?: {
    /**
     * Default max-age for rendered HTML pages in seconds.
     * 0 = browsers must revalidate; CDNs may still serve stale with SWR.
     * Default: 0
     */
    default_max_age?: number;
    /**
     * Default stale-while-revalidate in seconds (CDN / shared-cache only).
     * Default: 60
     */
    default_swr?: number;
    /**
     * Per-route overrides — first matching rule wins (longest prefix).
     * @example
     * rules:
     *   - pattern: "/blog"
     *     max_age: 300
     *     stale_while_revalidate: 3600
     *   - pattern: "/admin"
     *     no_store: true
     */
    rules?: HttpCacheRule[];
  };
  /**
   * Content workflow configuration.
   * Define custom stages and transitions for your editorial process.
   * If omitted, the default 4-stage workflow (draft → in_review → published → archived) is used.
   *
   * @example
   * ```yaml
   * workflow:
   *   stages:
   *     - id: draft
   *       label: Draft
   *       color: amber
   *     - id: legal_review
   *       label: Legal Review
   *       color: orange
   *     - id: published
   *       label: Published
   *       color: green
   *       publish: true
   *   transitions:
   *     - from: draft
   *       to: legal_review
   *       label: Submit for Legal Review
   *       roles: [author, editor]
   *     - from: legal_review
   *       to: published
   *       label: Approve & Publish
   *       roles: [admin]
   *     - from: published
   *       to: draft
   *       label: Unpublish
   *       roles: [admin]
   * ```
   */
  workflow?: {
    stages: WorkflowStage[];
    transitions: WorkflowTransition[];
  };
  /**
   * Machine translation provider configuration.
   * When present (and enabled), editors can request automatic translations
   * from the admin panel.
   */
  machine_translation?: MachineTranslationConfig;
  /**
   * XML sitemap generation settings.
   * The sitemap is served at /sitemap.xml.
   */
  sitemap?: {
    /**
     * Route prefixes or exact paths to exclude from the sitemap.
     * Prefix match — any route that equals or starts with a pattern is excluded.
     * @example ["/private", "/members"]
     */
    exclude?: string[];
    /**
     * Per-route changefreq overrides. Longest matching prefix wins.
     * Overrides the depth-based default (depth 0 → daily, 1 → weekly, 2+ → monthly).
     * @example { "/": "hourly", "/blog": "daily" }
     */
    changefreq?: Record<string, "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never">;
  };
}

/** System-level configuration (engine behavior) */
export interface SystemConfig {
  content: {
    dir: string;
    markdown: {
      extra: boolean;
      auto_links: boolean;
      auto_url_links: boolean;
    };
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
  /** Full-text search configuration. */
  search?: {
    /**
     * Additional frontmatter field names to include in the full-text index.
     * By default only title, body, and taxonomy values are indexed.
     * Add field names here to make custom frontmatter searchable.
     * @example ["summary", "tags", "author"]
     */
    customFields?: string[];
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
    slowQueryThresholdMs?: number;
  };
  debug: boolean;
  timezone: string;
}

/** Theme configuration */
export interface ThemeConfig {
  name: string;
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
