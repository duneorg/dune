/**
 * Configuration type definitions for Dune CMS.
 *
 * Re-exports all public types from the focused sub-modules:
 *   - role.ts          — Role
 *   - site-config.ts   — SiteConfig, HttpCacheRule
 *   - system-config.ts — SystemConfig, ThemeConfig, ConfigSource, SiteEntry, MultisiteConfig
 *   - dune-config.ts   — DuneConfig, PluginEntry
 *
 * @module
 */

export type { Role } from "./role.ts";

export type {
  FormEmailNotificationConfig,
  FormNotificationsConfig,
  FormsConfig,
  IncomingWebhookConfig,
  WebhookNotificationConfig,
} from "./forms-config.ts";

export type {
  HttpCacheRule,
  /** Site-level configuration (content, identity, metadata) */
  SiteConfig,
} from "./site-config.ts";

export type {
  ConfigSource,
  /** Top-level structure of `config/sites.yaml`. Present only when running in multi-site mode. */
  MultisiteConfig,
  /** One site entry in `config/sites.yaml`. A single Dune installation can serve multiple independent sites. */
  SiteEntry,
  /** System-level configuration (engine behavior) */
  SystemConfig,
  /** Theme configuration */
  ThemeConfig,
} from "./system-config.ts";

export type {
  /** Top-level Dune configuration (result of merging all config sources) */
  DuneConfig,
  /** A plugin entry in `site.yaml`'s `plugins:` list. */
  PluginEntry,
  /** The slice of the configuration a theme template may rely on. */
  TemplateConfig,
  ThemePackageEntry,
} from "./dune-config.ts";
