/**
 * Configuration type definitions for Dune CMS.
 */

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
