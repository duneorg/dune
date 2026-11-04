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
    base_dn: string;
    username_attr?: string;
    bind_dn?: string;
    bind_password?: string;
    email_attr?: string;
    name_attr?: string;
    role_map?: Array<{ group: string; role: Role }>;
    default_role?: Role;
  }
  | {
    type: "saml";
    entity_id: string;
    acs_url: string;
    idp_metadata: string;
    username_attr?: string;
    email_attr?: string;
    name_attr?: string;
    role_map?: Array<{ value: string; role: Role }>;
    role_attr?: string;
    default_role?: Role;
  };

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
  session_lifetime: number;
  /**
   * Runtime directory — ephemeral, machine-local, gitignored.
   * Stores: sessions, scheduled actions, revision history, workflow state.
   * (default: ".dune/admin")
   */
  runtime_dir: string;
  /** Whether admin panel is enabled (default: true) */
  enabled: boolean;
  /**
   * Maximum number of revisions to retain per page (default: 50).
   * When the limit is reached, the oldest revision is pruned on each save.
   */
  max_revisions?: number;
  /**
   * Maximum upload body size (in MB) for admin-side multipart uploads
   * (media library, content attachments). Rejected with 413 before the body
   * is buffered into memory. Public form submissions are gated separately at
   * a fixed 55 MB ceiling. Default: 100.
   */
  max_upload_mb?: number;
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
   * External authentication provider configuration.
   * When omitted, the built-in local password auth is used.
   *
   * @example LDAP
   * ```yaml
   * admin:
   *   auth_provider:
   *     type: "ldap"
   *     url: "ldaps://ldap.example.com"
   *     base_dn: "ou=users,dc=example,dc=com"
   *     bind_dn: "cn=service,dc=example,dc=com"
   *     bind_password: "$LDAP_BIND_PASSWORD"
   * ```
   *
   * @example SAML
   * ```yaml
   * admin:
   *   auth_provider:
   *     type: "saml"
   *     entity_id: "https://example.com/admin"
   *     acs_url: "https://example.com/admin/saml/acs"
   *     idp_metadata: "https://idp.example.com/metadata.xml"
   * ```
   */
  auth_provider?: AuthProviderConfig;
  /**
   * Polizy authz tuple store for the admin panel's own permission checks
   * (`pages.update`, `users.update`, etc.) — independent of
   * `site.auth.authz_store`, which is a *public*-auth setting for site
   * visitors. Default: `"local"`, created automatically whenever the admin
   * panel is enabled, regardless of what (if anything) `site.auth` is
   * configured to. Deliberately decoupled: an admin's tuples
   * (`bootstrapAdminTuples()`) are a different identity concern from
   * site-user tuples, and previously creation of this authz instance was
   * accidentally gated on the public-auth config instead of its own
   * setting — a site running `site.auth.mode: external-jwt` (or
   * `authz_store: "db"`) would silently lose the admin-panel authz instance.
   * That path now fails closed (deny) when `authz` is missing; there is no
   * role-table fallback.
   *
   * Only `"local"` is implemented today — a `"db"` tier (mirroring
   * `site.auth.authz_store`'s db-backed option) isn't wired up for the
   * admin side yet.
   */
  authz_store?: "local";
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
    log_file?: string;
  };
}
