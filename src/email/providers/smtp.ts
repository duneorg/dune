/**
 * SMTP email provider.
 *
 * Backed by nodemailer (already a dependency via src/admin/email.ts).
 * String config values beginning with "$" are expanded from environment
 * variables at send time, matching the existing SmtpNotificationConfig pattern.
 */

// @ts-types="npm:@types/nodemailer@^6"
import nodemailer from "nodemailer";
import type { EmailMessage, EmailProvider } from "../types.ts";

export interface SmtpProviderConfig {
  host: string;
  port: number;
  /** true = implicit TLS (port 465); false = STARTTLS (port 587) */
  secure: boolean;
  user: string;
  /** Supports "$ENV_VAR" expansion */
  pass: string;
  /** Default from address for this provider */
  from: string;
}

/**
 * Expand a config string value: if it starts with "$", substitute the
 * named environment variable. Returns an empty string when the variable
 * is not set so misconfigured deployments degrade gracefully.
 */
function envExpand(value: string): string {
  if (value.startsWith("$")) {
    return Deno.env.get(value.slice(1)) ?? "";
  }
  return value;
}

/** SMTP delivery provider using nodemailer. */
export class SmtpEmailProvider implements EmailProvider {
  readonly #cfg: SmtpProviderConfig;

  constructor(cfg: SmtpProviderConfig) {
    this.#cfg = cfg;
  }

  async send(message: EmailMessage): Promise<void> {
    const transporter = nodemailer.createTransport({
      host: this.#cfg.host,
      port: this.#cfg.port,
      secure: this.#cfg.secure,
      auth: {
        user: envExpand(this.#cfg.user),
        pass: envExpand(this.#cfg.pass),
      },
    });

    const from = message.from ?? this.#cfg.from;
    const to = Array.isArray(message.to) ? message.to.join(", ") : message.to;

    await transporter.sendMail({
      from,
      to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      ...(message.replyTo ? { replyTo: message.replyTo } : {}),
    });
  }
}
