/**
 * Postmark email provider.
 *
 * Sends via the Postmark API (https://postmarkapp.com) using native fetch.
 * API reference: https://postmarkapp.com/developer/api/email-api
 */

import type { EmailMessage, EmailProvider } from "../types.ts";

/** Configuration for the Postmark email provider. */
export interface PostmarkProviderConfig {
  apiKey: string;
  /** Default from address when message.from is not set. */
  from: string;
}

const POSTMARK_API_URL = "https://api.postmarkapp.com/email";

/** Postmark delivery provider. */
export class PostmarkEmailProvider implements EmailProvider {
  readonly #cfg: PostmarkProviderConfig;

  constructor(cfg: PostmarkProviderConfig) {
    this.#cfg = cfg;
  }

  async send(message: EmailMessage): Promise<void> {
    const from = message.from ?? this.#cfg.from;
    const to = Array.isArray(message.to) ? message.to.join(",") : message.to;

    const body: Record<string, unknown> = {
      From: from,
      To: to,
      Subject: message.subject,
      HtmlBody: message.html,
    };
    if (message.text) body["TextBody"] = message.text;
    if (message.replyTo) body["ReplyTo"] = message.replyTo;

    const res = await fetch(POSTMARK_API_URL, {
      method: "POST",
      headers: {
        "X-Postmark-Server-Token": this.#cfg.apiKey,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Postmark API error ${res.status}: ${detail}`);
    }
  }
}
