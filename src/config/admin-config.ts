/**
 * Admin panel configuration types.
 */

/**
 * User role — inlined here so that config does not depend on the admin
 * plugin package. Bare name (no "Admin" prefix) per
 * decisions/dec-identity-unification.md's Phase 3: role/identity concepts
 * aren't admin-panel-specific, even though this type currently only gates
 * admin-panel access — @dune/plugin-admin's role field uses this same type.
 */
export type Role = "admin" | "editor" | "author";

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
    roleMap?: Array<{ group: string; role: Role }>;
    defaultRole?: Role;
  }
  | {
    type: "saml";
    entityId: string;
    acsUrl: string;
    idpMetadata: string;
    usernameAttr?: string;
    emailAttr?: string;
    nameAttr?: string;
    roleMap?: Array<{ value: string; role: Role }>;
    roleAttr?: string;
    defaultRole?: Role;
  };

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
   * Polizy authz tuple store for the admin panel's own permission checks
   * (`pages.update`, `users.manage`, etc.) — independent of
   * `site.auth.authzStore`, which is a *public*-auth setting for site
   * visitors. Default: `"local"`, created automatically whenever the admin
   * panel is enabled, regardless of what (if anything) `site.auth` is
   * configured to. Deliberately decoupled: an admin's tuples
   * (`bootstrapAdminTuples()`) are a different identity concern from
   * site-user tuples, and previously creation of this authz instance was
   * accidentally gated on the public-auth config instead of its own
   * setting — a site running `site.auth.mode: external-jwt` (or
   * `authzStore: "db"`) would silently lose real admin-panel permission
   * checking too, falling back to the flat `ROLE_PERMISSIONS` table with
   * no warning.
   *
   * Only `"local"` is implemented today — a `"db"` tier (mirroring
   * `site.auth.authzStore`'s db-backed option) isn't wired up for the
   * admin side yet.
   */
  authzStore?: "local";
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
