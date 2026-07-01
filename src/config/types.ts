/**
 * Configuration type definitions for Dune CMS.
 */

import type { WorkflowStage, WorkflowTransition } from "../workflow/types.ts";
import type { MachineTranslationConfig } from "../mt/types.ts";

/**
 * Admin user role — inlined here so that config/types.ts does not depend on
 * the admin plugin package.
 */
export type AdminRole = "admin" | "editor" | "author";

/**
 * Auth provider configuration union — covers all supported provider backends.
 * Defined here (in core) to avoid a config ↔ plugin-admin circular dependency.
 */
export type AuthProviderConfig =
  | { type: "local" }
  | {
    type: "ldap";
    url: string;
    baseDn: string;
    usernameAttr?: string;
    bindDn?: string;
    bindPassword?: string;
    emailAttr?: string;
    nameAttr?: string;
    roleMap?: Array<{ group: string; role: AdminRole }>;
    defaultRole?: AdminRole;
  }
  | {
    type: "saml";
    entityId: string;
    acsUrl: string;
    idpMetadata: string;
    usernameAttr?: string;
    emailAttr?: string;
    nameAttr?: string;
    roleMap?: Array<{ value: string; role: AdminRole }>;
    roleAttr?: string;
    defaultRole?: AdminRole;
  };

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
  /**
   * Auto-discover and load any `.ts` files in the site's `plugins/` directory
   * that are not already listed in `pluginList`.
   *
   * Default: `false`. Auto-discovery executes arbitrary TypeScript at startup,
   * so opting in is required — rely on explicit entries in `site.yaml` unless
   * you have a trusted local workflow that expects drop-in plugin files.
   */
  autoDiscoverPlugins?: boolean;
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
   * Maximum upload body size (in MB) for admin-side multipart uploads
   * (media library, content attachments). Rejected with 413 before the body
   * is buffered into memory. Public form submissions are gated separately at
   * a fixed 55 MB ceiling. Default: 100.
   */
  maxUploadMb?: number;
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
   * External authentication provider configuration.
   * When omitted, the built-in local password auth is used.
   *
   * @example LDAP
   * ```yaml
   * admin:
   *   auth_provider:
   *     type: "ldap"
   *     url: "ldaps://ldap.example.com"
   *     baseDn: "ou=users,dc=example,dc=com"
   *     bindDn: "cn=service,dc=example,dc=com"
   *     bindPassword: "$LDAP_BIND_PASSWORD"
   * ```
   *
   * @example SAML
   * ```yaml
   * admin:
   *   auth_provider:
   *     type: "saml"
   *     entityId: "https://example.com/admin"
   *     acsUrl: "https://example.com/admin/saml/acs"
   *     idpMetadata: "https://idp.example.com/metadata.xml"
   * ```
   */
  auth_provider?: AuthProviderConfig;
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
  /**
   * Allow delivery to private/loopback/link-local addresses. Defaults to
   * false. Only set true for documented same-network use cases (e.g. an
   * internal CI bot at 10.x). Without this opt-in, the SSRF guard refuses
   * cloud-metadata, container-orchestrator, and intranet targets.
   */
  allow_private?: boolean;
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
  /** Allow delivery to private/loopback/link-local addresses. Default false. */
  allow_private?: boolean;
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
  /**
   * CDN cache invalidation configuration.
   * After each content rebuild, Dune purges affected routes from the CDN edge
   * cache so visitors see updated content without waiting for TTL expiry.
   *
   * @example Cloudflare
   * ```yaml
   * site:
   *   cdn:
   *     provider: cloudflare
   *     base_url: https://example.com
   *     cloudflare:
   *       zoneId: "$CF_ZONE_ID"
   *       apiToken: "$CF_API_TOKEN"
   * ```
   *
   * @example BunnyCDN
   * ```yaml
   * site:
   *   cdn:
   *     provider: bunny
   *     base_url: https://example.com
   *     bunny:
   *       apiKey: "$BUNNY_API_KEY"
   * ```
   */
  cdn?: {
    /** CDN provider to use for cache invalidation. */
    provider?: "cloudflare" | "fastly" | "bunny" | "custom";
    /**
     * Base URL of the site as seen by the CDN.
     * Used to build absolute purge URLs from site-relative routes.
     * @example "https://example.com"
     */
    base_url?: string;
    cloudflare?: { zoneId: string; apiToken: string };
    fastly?: { serviceId: string; apiKey: string };
    bunny?: { apiKey: string; pullZoneId?: string };
    /**
     * Custom provider: receives POST with body { urls: string[] }.
     * api_token is sent as Authorization: Bearer {api_token} when present.
     */
    custom?: { purge_url: string; api_token?: string };
  };
  /**
   * Trust raw HTML in authored content.
   *
   * When `false` (default), HTML inside markdown bodies and page-builder
   * richtext fields is sanitized — script tags, event handlers, and
   * `javascript:` URLs are stripped. This prevents stored XSS from
   * lower-privilege editors (or migrated third-party content).
   *
   * Set to `true` only when every author is fully trusted AND the site does
   * not import content from external sources (WordPress WXR, Grav, etc.).
   */
  trusted_html?: boolean;
  /**
   * Public site authentication configuration.
   * Enables visitor logins via OAuth, magic links, or external JWT.
   * Completely separate from the admin auth subsystem.
   *
   * @example GitHub OAuth
   * ```yaml
   * site:
   *   auth:
   *     providers:
   *       github:
   *         clientId: "$GITHUB_CLIENT_ID"
   *         clientSecret: "$GITHUB_CLIENT_SECRET"
   * ```
   *
   * @example External JWT (Clerk, Auth0, etc.)
   * ```yaml
   * site:
   *   auth:
   *     mode: external-jwt
   *     jwt:
   *       jwksUrl: "https://your-tenant.clerk.accounts.dev/.well-known/jwks.json"
   * ```
   */
  auth?: {
    /**
     * Authentication mode.
     * "dune" — built-in OAuth and/or magic link (default).
     * "external-jwt" — validate Bearer JWT tokens from an external provider.
     */
    mode?: "dune" | "external-jwt";
    /** OAuth provider credentials. */
    providers?: {
      github?: { clientId: string; clientSecret: string };
      google?: { clientId: string; clientSecret: string };
      discord?: { clientId: string; clientSecret: string };
      magicLink?: { enabled: boolean };
    };
    /** JWT verification options — used when mode is "external-jwt". */
    jwt?: {
      /** HMAC-SHA256 shared secret for HS256 tokens. */
      secret?: string;
      /** JWKS endpoint URL for RS256 tokens (Clerk, Auth0, etc.). */
      jwksUrl?: string;
      /** JWT claim containing the user ID. Default: "sub". */
      userIdClaim?: string;
      /** JWT claim containing the user email. Default: "email". */
      emailClaim?: string;
      /** JWT claim containing role(s) (string or string[]). Default: "roles". */
      rolesClaim?: string;
      /**
       * Expected `iss` claim. Strongly recommended in external-jwt mode:
       * without it, any token signed by the same IdP (e.g. another tenant on a
       * shared JWKS endpoint) is accepted.
       */
      issuer?: string;
      /**
       * Expected `aud` claim. The token's audience (string or string[]) must
       * contain this value, preventing tokens minted for a different app that
       * shares the IdP's signing keys from being accepted.
       */
      audience?: string;
      /**
       * Pin the accepted signing algorithm ("HS256" or "RS256"). When set, a
       * token whose header alg differs is rejected — defense-in-depth against
       * algorithm-substitution attacks.
       */
      algorithm?: "HS256" | "RS256";
    };
    /**
     * Session lifetime in seconds. Default: 2592000 (30 days).
     * Not used in external-jwt mode (sessions are stateless).
     */
    sessionLifetime?: number;
    /**
     * User store backend.
     *   "local"   — flat-file records in data/users/ (default)
     *   "session" — no server-side records; identity synthesised from OAuth/magic-link
     *               claims and embedded in the session cookie. Roles assigned after
     *               login (e.g. via payment) are not reflected until the user logs
     *               out and back in. A database-backed store is planned.
     */
    userStore?: "local" | "session" | "db";
    /**
     * IdP webhook configuration — enables POST /auth/webhook for receiving
     * user lifecycle events from the external identity provider.
     *
     * Only active in external-jwt + authzStore:local mode.
     * Handles user.deleted events: revokes all authz tuples for the deleted user.
     * Role-change events are handled automatically by per-request fingerprint
     * reconciliation and do not require a webhook.
     *
     * @example
     * ```yaml
     * auth:
     *   mode: external-jwt
     *   authzStore: local
     *   webhook:
     *     provider: clerk
     *     secret: "$DUNE_CLERK_WEBHOOK_SECRET"
     * ```
     */
    webhook?: {
      /** Provider type — determines signature verification format. */
      provider: "clerk" | "auth0" | "generic";
      /** Shared HMAC secret. Use "$ENV_VAR" to read from an environment variable. */
      secret: string;
      /**
       * Custom signature header name for "generic" provider.
       * Default: "x-dune-signature".
       */
      signatureHeader?: string;
    };
  };
  /**
   * Transactional email configuration.
   * Enables the `email.send()` API for plugins, route handlers, and TSX pages.
   * Distinct from `admin.notifications.email` which is used for form submission
   * notifications only.
   *
   * When omitted, the console provider is used (emails are logged to stdout).
   *
   * @example Resend
   * ```yaml
   * site:
   *   email:
   *     provider: resend
   *     from: hello@example.com
   *     resend:
   *       apiKey: "$RESEND_API_KEY"
   * ```
   *
   * @example SMTP
   * ```yaml
   * site:
   *   email:
   *     provider: smtp
   *     from: hello@example.com
   *     smtp:
   *       host: smtp.example.com
   *       port: 587
   *       secure: false
   *       user: "$SMTP_USER"
   *       pass: "$SMTP_PASS"
   * ```
   */
  email?: {
    /**
     * Email delivery provider.
     * Defaults to "console" (logs to stdout — suitable for local development).
     */
    provider?: "smtp" | "resend" | "postmark" | "sendgrid" | "console";
    /**
     * Default from address for all outgoing emails.
     * @example "hello@example.com"
     */
    from?: string;
    smtp?: {
      host: string;
      port: number;
      /** true = implicit TLS on port 465; false = STARTTLS on port 587 */
      secure: boolean;
      user: string;
      /** Supports "$ENV_VAR" expansion */
      pass: string;
    };
    resend?: { apiKey: string };
    postmark?: { apiKey: string };
    sendgrid?: { apiKey: string };
  };
  /**
   * Public file upload configuration.
   * Controls the `POST /api/upload` endpoint available to anonymous (or
   * authenticated) site visitors, separate from the admin media upload.
   *
   * @example
   * ```yaml
   * uploads:
   *   max_size_mb: 5
   *   allowed_types: ["image/jpeg", "image/png", "image/webp", "application/pdf"]
   *   require_auth: false
   * ```
   */
  uploads?: {
    /**
     * Maximum upload size in megabytes.
     * Requests with a declared Content-Length above this limit are rejected
     * with HTTP 413 before the body is buffered. Default: 10.
     */
    maxSizeMb?: number;
    /**
     * MIME types permitted for upload.
     * Defaults to common images (JPEG, PNG, WebP, GIF, AVIF) plus PDF.
     * The server derives the MIME type from the file extension — the
     * client-supplied type is never trusted.
     */
    allowedTypes?: string[];
    /**
     * Require a logged-in site user to upload.
     * When `true`, requests without a valid session token are rejected
     * with HTTP 401. Default: false (anonymous upload permitted).
     */
    requireAuth?: boolean;
  };
  /**
   * Background jobs — explicit list of job files to load.
   *
   * Each entry is a path relative to the project root, e.g.:
   *   - ./jobs/weekly-digest.ts
   *   - ./jobs/sitemap-rebuild.ts
   *
   * Only the files listed here are imported and scheduled. Unlisted files in
   * the `jobs/` directory are ignored, preventing arbitrary code execution if
   * an attacker can write files into that directory.
   *
   * When this key is absent, Dune falls back to auto-discovering all *.ts
   * files under `jobs/` (legacy behaviour, emits a startup warning).
   * Set `jobs: []` to disable all background jobs with no warning.
   *
   * @example
   * ```yaml
   * site:
   *   jobs:
   *     - ./jobs/weekly-digest.ts
   *     - ./jobs/sitemap-rebuild.ts
   * ```
   */
  jobs?: string[];

  /**
   * Payment provider configuration.
   * When present, Dune registers three payment routes:
   *   POST /payments/checkout/:productId
   *   POST /payments/webhook
   *   GET  /payments/portal
   *
   * Only "stripe" is supported as a provider in this release.
   * Secret values support "$ENV_VAR" expansion.
   *
   * @example
   * ```yaml
   * site:
   *   payments:
   *     provider: stripe
   *     secret_key: "$STRIPE_SECRET_KEY"
   *     webhook_secret: "$STRIPE_WEBHOOK_SECRET"
   *     products:
   *       - id: membership
   *         name: Monthly Membership
   *         price_id: price_xxx
   *         role: member
   *         mode: subscription
   * ```
   */
  payments?: {
    /**
     * Payment provider name.
     * Only "stripe" is supported in this release.
     */
    provider?: "stripe";
    /**
     * Provider secret key. Supports "$ENV_VAR" expansion.
     * For Stripe: sk_live_xxx or sk_test_xxx.
     */
    secret_key?: string;
    /**
     * Webhook signing secret. Supports "$ENV_VAR" expansion.
     * For Stripe: whsec_xxx from the Stripe dashboard.
     */
    webhook_secret?: string;
    /**
     * Products available for purchase.
     * Each product maps to a provider-side price and an optional Dune role.
     */
    products?: Array<{
      /** Site-defined product identifier, used in the checkout URL. */
      id: string;
      /** Human-readable product name. */
      name: string;
      /** Provider price ID (e.g. Stripe price_xxx). */
      price_id: string;
      /**
       * Role to assign to the user upon successful payment.
       * Must match a role string used in content gating rules.
       */
      role?: string;
      /**
       * Checkout mode: "subscription" (recurring) or "payment" (one-time).
       * Defaults to "subscription".
       */
      mode?: "subscription" | "payment";
    }>;
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
    /**
     * Roles permitted to create or save pages with `format: tsx`.
     * TSX pages execute arbitrary Deno code during SSR and must be treated
     * as equivalent to server shell access. Default: `["admin"]`.
     * Set to `[]` to disable TSX content entirely.
     */
    allowTsxFormat?: string[];
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
     * Additional frontmatter field names to include in the full-text index.
     * By default only title, body, and taxonomy values are indexed.
     * Add field names here to make custom frontmatter searchable.
     * @example ["summary", "tags", "author"]
     */
    customFields?: string[];
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
   * and bypass per-IP rate limits or evade lockout.
   *
   * @since 1.0.0
   */
  trusted_proxies?: boolean;
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
