/**
 * Notifications for stored form submissions: an email through the site's
 * email provider, and/or a (signed) webhook POST. Both are fire-and-forget
 * from the submitter's point of view: failures are logged, never returned.
 *
 * @module
 */

import type { DuneConfig, FormEmailNotificationConfig } from "../config/types.ts";
import type { WebhookNotificationConfig } from "../config/types.ts";
import { createEmailProvider } from "../email/providers/mod.ts";
import type { EmailProvider } from "../email/types.ts";
import { safeFetch } from "../security/mod.ts";
import { logger } from "../core/logger.ts";
import type { Submission } from "./submissions.ts";
import type { ResolvedFormsConfig } from "./config.ts";

/** Expand "$VAR" to the environment variable's value ("" when unset). */
function envExpand(value: string): string {
  return value.startsWith("$") ? (Deno.env.get(value.slice(1)) ?? "") : value;
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Subject, plain-text and HTML bodies for a submission email. */
export function renderSubmissionEmail(
  submission: Submission,
  subjectTemplate?: string,
): { subject: string; text: string; html: string } {
  const subject = (subjectTemplate ?? "New {form} submission").replace(/\{form\}/g, submission.form);
  const receivedStr = new Date(submission.receivedAt).toISOString();
  const files = submission.files ?? [];

  const text = [
    `New submission received for form: ${submission.form}`,
    `Received: ${receivedStr}`,
    `ID: ${submission.id}`,
    "",
    "Fields:",
    ...Object.entries(submission.fields).map(([k, v]) => `${k}: ${v}`),
    ...(files.length > 0
      ? ["", "Attachments:", ...files.map((f) => `  ${f.name} (${f.contentType}, ${f.size} bytes)`)]
      : []),
  ].join("\n");

  const row = (k: string, v: string) =>
    `<tr><th style="text-align:left;padding:4px 8px;background:#f5f5f5">${escHtml(k)}</th><td style="padding:4px 8px">${escHtml(v)}</td></tr>`;
  const html = `
<div style="font-family:system-ui,sans-serif;max-width:600px">
  <h2 style="color:#1a1a2e">New ${escHtml(submission.form)} submission</h2>
  <p style="color:#666;font-size:0.9em">Received ${escHtml(receivedStr)} — ID: ${escHtml(submission.id)}</p>
  <table style="width:100%;border-collapse:collapse;border:1px solid #e0e0e0">
    ${Object.entries(submission.fields).map(([k, v]) => row(k, v)).join("")}${
    files.map((f) => row("attachment", `${f.name} (${f.contentType}, ${f.size} bytes)`)).join("")
  }
  </table>
</div>`.trim();

  return { subject, text, html };
}

/**
 * POST a submission to a webhook URL, signed with HMAC-SHA256 when a secret
 * is configured (`X-Dune-Signature: sha256=<hex>`). Throws on non-2xx.
 */
export async function sendWebhookNotification(
  cfg: WebhookNotificationConfig,
  submission: Submission,
): Promise<void> {
  const body = JSON.stringify(submission);
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "User-Agent": "Dune-CMS/0.3",
  };

  const secret = cfg.secret ? envExpand(cfg.secret) : null;
  if (secret) {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
    headers["X-Dune-Signature"] = `sha256=${
      Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("")
    }`;
  }

  const resp = await safeFetch(
    cfg.url,
    { method: "POST", headers, body },
    { allowPrivateDestinations: cfg.allow_private === true },
  );
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(
      `Webhook POST to ${cfg.url} failed: ${resp.status} ${resp.statusText}${text ? ` — ${text.slice(0, 200)}` : ""}`,
    );
  }
}

export interface NotificationOverrides {
  /** Per-form email override — replaces the `to` address. */
  emailTo?: string;
  /** Per-form webhook override — replaces the URL, keeps global secret/headers. */
  webhookUrl?: string;
}

/** Sends notifications for stored submissions. */
export interface SubmissionNotifier {
  dispatch(submission: Submission, overrides?: NotificationOverrides): void;
}

/** Pick the provider for an email notification: the site's `site.email` provider. */
function providerFor(
  cfg: FormEmailNotificationConfig,
  config: DuneConfig,
): { provider: EmailProvider; from: string } {
  const siteEmail = config.site?.email ?? {};
  const from = cfg.from ?? siteEmail.from ?? defaultFrom(config);
  return { provider: createEmailProvider(siteEmail), from };
}

function defaultFrom(config: DuneConfig): string {
  try {
    return `noreply@${new URL(config.site.url).hostname}`;
  } catch {
    return "noreply@localhost";
  }
}

export function createSubmissionNotifier(
  config: DuneConfig,
  forms: ResolvedFormsConfig,
  /** Test seam: replaces the email provider and the webhook sender. */
  deps: {
    emailProvider?: EmailProvider;
    sendWebhook?: typeof sendWebhookNotification;
  } = {},
): SubmissionNotifier {
  const sendWebhook = deps.sendWebhook ?? sendWebhookNotification;
  return {
    dispatch(submission, overrides = {}) {
      const notif = forms.notifications;
      if (!notif) return;

      if (notif.email) {
        const cfg = overrides.emailTo ? { ...notif.email, to: overrides.emailTo } : notif.email;
        const { subject, text, html } = renderSubmissionEmail(submission, cfg.subject);
        (async () => {
          const { provider, from } = providerFor(cfg, config);
          await (deps.emailProvider ?? provider).send({ to: cfg.to, subject, text, html, from });
        })().catch((err: Error) =>
          logger.error("forms.notify.email_failed", { form: submission.form, reason: err.message })
        );
      }

      if (notif.webhook || overrides.webhookUrl) {
        const cfg = overrides.webhookUrl
          ? { ...(notif.webhook ?? {}), url: overrides.webhookUrl } as WebhookNotificationConfig
          : notif.webhook!;
        sendWebhook(cfg, submission).catch((err: Error) =>
          logger.error("forms.notify.webhook_failed", { form: submission.form, reason: err.message })
        );
      }
    },
  };
}
