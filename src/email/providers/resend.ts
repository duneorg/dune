/**
 * Resend email provider.
 *
 * Sends via the Resend API (https://resend.com) using native fetch.
 * API reference: https://resend.com/docs/api-reference/emails/send-email
 */

import type { EmailMessage, EmailProvider } from "../types.ts";

/** Configuration for the Resend email provider. */
export interface ResendProviderConfig {
  apiKey: string;
  /** Default from address when message.from is not set. */
  from: string;
}

const RESEND_API_URL = "https://api.resend.com/emails";

/** Resend delivery provider. */
export class ResendEmailProvider implements EmailProvider {
  readonly #cfg: ResendProviderConfig;

  constructor(cfg: ResendProviderConfig) {
    this.#cfg = cfg;
  }

  async send(message: EmailMessage): Promise<void> {
    const from = message.from ?? this.#cfg.from;
    const to = Array.isArray(message.to) ? message.to : [message.to];

    const body: Record<string, unknown> = {
      from,
      to,
      subject: message.subject,
      html: message.html,
    };
    if (message.text) body["text"] = message.text;
    if (message.replyTo) body["reply_to"] = message.replyTo;

    const res = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.#cfg.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Resend API error ${res.status}: ${detail}`);
    }
  }
}
