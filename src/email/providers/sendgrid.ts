/**
 * SendGrid email provider.
 *
 * Sends via the SendGrid v3 Mail Send API using native fetch.
 * API reference: https://docs.sendgrid.com/api-reference/mail-send/mail-send
 */

import type { EmailMessage, EmailProvider } from "../types.ts";

export interface SendGridProviderConfig {
  apiKey: string;
  /** Default from address when message.from is not set. */
  from: string;
}

const SENDGRID_API_URL = "https://api.sendgrid.com/v3/mail/send";

/** SendGrid delivery provider. */
export class SendGridEmailProvider implements EmailProvider {
  readonly #cfg: SendGridProviderConfig;

  constructor(cfg: SendGridProviderConfig) {
    this.#cfg = cfg;
  }

  async send(message: EmailMessage): Promise<void> {
    const from = message.from ?? this.#cfg.from;
    const toAddresses = Array.isArray(message.to) ? message.to : [message.to];

    const content: Array<{ type: string; value: string }> = [
      { type: "text/html", value: message.html },
    ];
    if (message.text) {
      content.unshift({ type: "text/plain", value: message.text });
    }

    const body: Record<string, unknown> = {
      from: { email: from },
      personalizations: [
        { to: toAddresses.map((addr) => ({ email: addr })) },
      ],
      subject: message.subject,
      content,
    };
    if (message.replyTo) {
      body["reply_to"] = { email: message.replyTo };
    }

    const res = await fetch(SENDGRID_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.#cfg.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    // SendGrid returns 202 Accepted on success (no response body)
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`SendGrid API error ${res.status}: ${detail}`);
    }
  }
}
