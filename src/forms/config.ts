/**
 * Resolve the effective forms / incoming-webhook settings.
 *
 * New keys (`site.forms`, `system.webhooks.incoming`, `system.data_dir`) win;
 * the old `admin.*` keys are read as a fallback, with one deprecation warning
 * each, so existing sites keep working for a release.
 *
 * @module
 */

import type { DuneConfig } from "../config/types.ts";
import type { FormNotificationsConfig, IncomingWebhookConfig } from "../config/types.ts";
import { logger } from "../core/logger.ts";

export interface ResolvedFormsConfig {
  honeypot: string;
  notifications?: FormNotificationsConfig;
  incomingWebhooks: IncomingWebhookConfig[];
  /** Persistent data directory; submissions live in `<dataDir>/submissions`. */
  dataDir: string;
}

const DEFAULT_DATA_DIR = "data";
const warned = new Set<string>();

function deprecated(oldKey: string, newKey: string): void {
  if (warned.has(oldKey)) return;
  warned.add(oldKey);
  logger.warn("config.deprecated_key", {
    key: oldKey,
    use: newKey,
    reason: `${oldKey} still works but will be removed; move it to ${newKey}`,
  });
}

/** Forget which deprecations were already reported (tests). */
export function resetFormsConfigWarnings(): void {
  warned.clear();
}

/** Compute the effective settings from the loaded config. */
export function resolveFormsConfig(config: DuneConfig): ResolvedFormsConfig {
  const forms = config.site?.forms;
  const admin = config.admin;

  let honeypot = forms?.honeypot;
  if (honeypot === undefined && admin?.honeypot !== undefined) {
    deprecated("admin.honeypot", "forms.honeypot (site.yaml)");
    honeypot = admin.honeypot;
  }

  let notifications = forms?.notifications;
  if (notifications === undefined && admin?.notifications !== undefined) {
    deprecated("admin.notifications", "forms.notifications (site.yaml)");
    notifications = admin.notifications;
  }
  if (notifications?.email?.smtp) {
    deprecated(
      "forms.notifications.email.smtp",
      "site.email (one provider for every email the site sends)",
    );
  }

  let incomingWebhooks = config.system?.webhooks?.incoming;
  if (incomingWebhooks === undefined && admin?.incoming_webhooks !== undefined) {
    deprecated("admin.incoming_webhooks", "webhooks.incoming (system.yaml)");
    incomingWebhooks = admin.incoming_webhooks;
  }

  let dataDir = config.system?.data_dir;
  if (dataDir === undefined && admin?.dataDir && admin.dataDir !== DEFAULT_DATA_DIR) {
    deprecated("admin.dataDir", "data_dir (system.yaml)");
    dataDir = admin.dataDir;
  }

  return {
    honeypot: honeypot ?? "_hp",
    notifications,
    incomingWebhooks: incomingWebhooks ?? [],
    dataDir: dataDir ?? DEFAULT_DATA_DIR,
  };
}
