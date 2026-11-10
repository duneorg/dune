/**
 * Resolve the effective forms / incoming-webhook settings and the data
 * directory from the loaded config (`site.forms`, `system.webhooks.incoming`,
 * `system.data_dir`).
 *
 * @module
 */

import type { DuneConfig } from "../config/types.ts";
import type { FormNotificationsConfig, IncomingWebhookConfig } from "../config/types.ts";

export interface ResolvedFormsConfig {
  honeypot: string;
  notifications?: FormNotificationsConfig;
  incomingWebhooks: IncomingWebhookConfig[];
  /** Persistent data directory; submissions live in `<dataDir>/submissions`. */
  dataDir: string;
}

const DEFAULT_DATA_DIR = "data";

/** The persistent data directory: `system.data_dir`, default `data`. */
export function resolveDataDir(config: DuneConfig): string {
  return config.system?.data_dir ?? DEFAULT_DATA_DIR;
}

const DEFAULT_RUNTIME_DIR = ".dune/admin";

/**
 * Machine-local runtime state (job state, revision history, scheduled actions,
 * staged drafts, search analytics): `system.runtime_dir`, default `.dune/admin`.
 * The default still carries the admin's name so existing sites keep their state.
 */
export function resolveRuntimeDir(config: DuneConfig): string {
  return config.system?.runtime_dir ?? DEFAULT_RUNTIME_DIR;
}

/** Revisions kept per page: `system.max_revisions`, default 50 (0 keeps all). */
export function resolveMaxRevisions(config: DuneConfig): number {
  return config.system?.max_revisions ?? 50;
}

/** Compute the effective settings from the loaded config. */
export function resolveFormsConfig(config: DuneConfig): ResolvedFormsConfig {
  return {
    honeypot: config.site?.forms?.honeypot ?? "_hp",
    notifications: config.site?.forms?.notifications,
    incomingWebhooks: config.system?.webhooks?.incoming ?? [],
    dataDir: resolveDataDir(config),
  };
}
