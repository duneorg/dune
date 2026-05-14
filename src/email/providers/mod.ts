/**
 * Email provider factory.
 *
 * Creates the appropriate EmailProvider from site config.
 * Falls back to ConsoleEmailProvider when no provider is configured
 * (safe for local development — no emails are actually sent).
 */

import type { EmailProvider } from "../types.ts";
import { ConsoleEmailProvider } from "./console.ts";
import { SmtpEmailProvider } from "./smtp.ts";
import { ResendEmailProvider } from "./resend.ts";
import { PostmarkEmailProvider } from "./postmark.ts";
import { SendGridEmailProvider } from "./sendgrid.ts";

export type { SmtpProviderConfig } from "./smtp.ts";
export type { ResendProviderConfig } from "./resend.ts";
export type { PostmarkProviderConfig } from "./postmark.ts";
export type { SendGridProviderConfig } from "./sendgrid.ts";

/** Configuration shape for the email provider (subset of SiteConfig.email). */
export interface EmailConfig {
  provider?: "smtp" | "resend" | "postmark" | "sendgrid" | "console";
  /** Default from address used when a message doesn't specify one. */
  from?: string;
  smtp?: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
  };
  resend?: { apiKey: string };
  postmark?: { apiKey: string };
  sendgrid?: { apiKey: string };
}

/**
 * Create an EmailProvider from the supplied config.
 *
 * When `provider` is omitted or set to "console" (or when the required
 * provider credentials are missing), a ConsoleEmailProvider is returned.
 */
export function createEmailProvider(config: EmailConfig): EmailProvider {
  const from = config.from ?? "noreply@example.com";

  switch (config.provider) {
    case "smtp": {
      if (!config.smtp) {
        console.warn("[Dune Email] smtp provider selected but no smtp config found — falling back to console");
        return new ConsoleEmailProvider();
      }
      return new SmtpEmailProvider({ ...config.smtp, from });
    }

    case "resend": {
      if (!config.resend?.apiKey) {
        console.warn("[Dune Email] resend provider selected but no apiKey found — falling back to console");
        return new ConsoleEmailProvider();
      }
      return new ResendEmailProvider({ apiKey: config.resend.apiKey, from });
    }

    case "postmark": {
      if (!config.postmark?.apiKey) {
        console.warn("[Dune Email] postmark provider selected but no apiKey found — falling back to console");
        return new ConsoleEmailProvider();
      }
      return new PostmarkEmailProvider({ apiKey: config.postmark.apiKey, from });
    }

    case "sendgrid": {
      if (!config.sendgrid?.apiKey) {
        console.warn("[Dune Email] sendgrid provider selected but no apiKey found — falling back to console");
        return new ConsoleEmailProvider();
      }
      return new SendGridEmailProvider({ apiKey: config.sendgrid.apiKey, from });
    }

    case "console":
    default:
      return new ConsoleEmailProvider();
  }
}
