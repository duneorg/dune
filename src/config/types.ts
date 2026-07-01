/**
 * Configuration type definitions for Dune CMS.
 *
 * Re-exports all public types from the focused sub-modules:
 *   - admin-config.ts  — AdminConfig, AdminRole, AuthProviderConfig, webhook/notification types
 *   - site-config.ts   — SiteConfig, HttpCacheRule
 *   - system-config.ts — SystemConfig, ThemeConfig, ConfigSource, SiteEntry, MultisiteConfig
 *   - dune-config.ts   — DuneConfig, PluginEntry
 */

export type {
  AdminRole,
  AuthProviderConfig,
  AdminConfig,
  AdminNotificationsConfig,
  SmtpNotificationConfig,
  WebhookNotificationConfig,
  WebhookContentEvent,
  WebhookEndpointConfig,
} from "./admin-config.ts";

export type {
  HttpCacheRule,
  SiteConfig,
} from "./site-config.ts";

export type {
  SystemConfig,
  ThemeConfig,
  ConfigSource,
  SiteEntry,
  MultisiteConfig,
} from "./system-config.ts";

export type {
  PluginEntry,
  DuneConfig,
} from "./dune-config.ts";
