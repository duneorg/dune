/**
 * Site-level configuration types.
 */

import type { WorkflowStage, WorkflowTransition } from "../workflow/types.ts";
import type { MachineTranslationConfig } from "../mt/types.ts";

/**
 * A per-route HTTP cache rule.
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
