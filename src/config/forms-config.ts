/**
 * Public forms and incoming webhook configuration.
 *
 * These features run in core and need no admin plugin, so their settings live
 * outside `admin:`:
 *
 *   site.yaml    forms:            honeypot, notifications
 *   system.yaml  webhooks.incoming  token-authenticated deploy/cache hooks
 *   system.yaml  data_dir           where submissions are stored
 *
 * The old `admin.honeypot`, `admin.notifications`, `admin.incoming_webhooks`
 * and `admin.dataDir` keys are still read, with a deprecation warning.
 *
 * @module
 */


/** An email sent for each new submission. */
export interface FormEmailNotificationConfig {
  /** Recipient address(es). A form's own `notifications.email` replaces this. */
  to: string | string[];
  /** Subject; `{form}` is replaced by the form name. Default: "New {form} submission". */
  subject?: string;
  /** From address. Defaults to `site.email.from`. */
  from?: string;
}

/** Notifications fired after a form submission is stored. */
export interface FormNotificationsConfig {
  /** Sent through `site.email` (any provider). */
  email?: FormEmailNotificationConfig;
  /** POST the submission JSON to a URL, optionally HMAC-signed. */
  webhook?: WebhookNotificationConfig;
}

/** `forms:` block of site.yaml. */
export interface FormsConfig {
  /**
   * Honeypot field name. A submission with this field filled in is silently
   * discarded. Default: "_hp".
   */
  honeypot?: string;
  notifications?: FormNotificationsConfig;
}

/** One token accepted by `POST /api/webhook/incoming`. */
export interface IncomingWebhookConfig {
  /** Secret token — supports "$ENV_VAR" expansion. */
  token: string;
  /** Actions this token may trigger. */
  actions: Array<"rebuild" | "purge-cache">;
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
