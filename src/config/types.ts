/**
 * Configuration type definitions for Dune CMS.
 *
 * Re-exports all public types from the focused sub-modules:
 *   - admin-config.ts  — AdminConfig, Role, AuthProviderConfig, webhook/notification types
 *   - site-config.ts   — SiteConfig, HttpCacheRule
 *   - system-config.ts — SystemConfig, ThemeConfig, ConfigSource, SiteEntry, MultisiteConfig
 *   - dune-config.ts   — DuneConfig, PluginEntry
 *
 * @module
 */

export type {
  Role,
  AuthProviderConfig,
  /** Admin panel configuration */
  AdminConfig,
  AdminNotificationsConfig,
  SmtpNotificationConfig,
  WebhookNotificationConfig,
  WebhookContentEvent,
  WebhookEndpointConfig,
} from "./admin-config.ts";

export type {
  HttpCacheRule,
  /** Site-level configuration (content, identity, metadata) */
  SiteConfig,
} from "./site-config.ts";

export type {
  /** System-level configuration (engine behavior) */
  SystemConfig,
  /** Theme configuration */
  ThemeConfig,
  ConfigSource,
  /** One site entry in `config/sites.yaml`. A single Dune installation can serve multiple independent sites. */
  SiteEntry,
  /** Top-level structure of `config/sites.yaml`. Present only when running in multi-site mode. */
  MultisiteConfig,
} from "./system-config.ts";

export type {
  /** A plugin entry in `site.yaml`'s `plugins:` list. */
  PluginEntry,
  ThemePackageEntry,
  /** Top-level Dune configuration (result of merging all config sources) */
  DuneConfig,
} from "./dune-config.ts";
