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
import { DevDomainFilterEmailProvider } from "./dev-domain-filter.ts";

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
 * Whether DUNE_ENV=dev is set. Mirrors ConsoleEmailProvider's own check
 * (src/email/providers/console.ts) — wrapped in try/catch since env access
 * requires --allow-env and this must fail safe (assume dev) rather than
 * throw if it's not granted.
 */
function isDevEnv(): boolean {
  try {
    return Deno.env.get("DUNE_ENV") === "dev";
  } catch {
    return false;
  }
}

/**
 * Whether a real (non-console) provider is explicitly allowed to send live
 * email under DUNE_ENV=dev. Off by default — a validly configured live
 * provider (real SMTP creds, a real API key) would otherwise send real mail
 * in dev exactly as in production, with nothing distinguishing the two.
 * Opt in with DUNE_EMAIL_ALLOW_DEV_SEND=1 (matches the DUNE_AUTHZ_HMAC_STRICT
 * env-flag convention) for the rare case dev genuinely needs to verify
 * real delivery.
 */
function devSendAllowed(): boolean {
  try {
    const v = Deno.env.get("DUNE_EMAIL_ALLOW_DEV_SEND");
    return v === "1" || v?.toLowerCase() === "true";
  } catch {
    return false;
  }
}

/**
 * Parsed DUNE_EMAIL_DEV_ALLOWED_DOMAINS (comma-separated), or null when unset.
 * A safer middle ground than DUNE_EMAIL_ALLOW_DEV_SEND=1: real sends stay
 * bounded to known-safe recipient domains instead of "everyone the
 * configured credentials can reach" — guards against a dev environment
 * somehow pointed at production-like data (a seeded/cloned dataset, a bug).
 * Takes precedence over DUNE_EMAIL_ALLOW_DEV_SEND when both are set.
 */
function devAllowedDomains(): string[] | null {
  try {
    const v = Deno.env.get("DUNE_EMAIL_DEV_ALLOWED_DOMAINS");
    if (!v) return null;
    const domains = v.split(",").map((d) => d.trim()).filter(Boolean);
    return domains.length > 0 ? domains : null;
  } catch {
    return null;
  }
}

/**
 * Create an EmailProvider from the supplied config.
 *
 * When `provider` is omitted or set to "console" (or when the required
 * provider credentials are missing), a ConsoleEmailProvider is returned.
 *
 * Under DUNE_ENV=dev, a configured live provider (smtp/resend/postmark/
 * sendgrid) is refused and swapped for ConsoleEmailProvider unless either:
 *   - DUNE_EMAIL_DEV_ALLOWED_DOMAINS is set — real provider is constructed,
 *     but wrapped so only recipients on an allowed domain are actually sent
 *     for real; anything else redirects to console. Takes precedence.
 *   - DUNE_EMAIL_ALLOW_DEV_SEND=1 is set — real provider, unrestricted.
 * A validly configured live provider previously sent real mail in dev with
 * zero indication anything was different from production.
 */
export function createEmailProvider(config: EmailConfig): EmailProvider {
  const from = config.from ?? "noreply@example.com";
  const liveProviderRequested = !!config.provider && config.provider !== "console";

  if (liveProviderRequested && isDevEnv()) {
    const allowedDomains = devAllowedDomains();
    if (allowedDomains) {
      const real = createRawProvider(config, from);
      if (!(real instanceof ConsoleEmailProvider)) {
        console.warn(
          `[Dune Email] DUNE_ENV=dev — real sends for "${config.provider}" restricted to: ` +
            `${allowedDomains.join(", ")} (DUNE_EMAIL_DEV_ALLOWED_DOMAINS). ` +
            "Any other recipient redirects to console instead.",
        );
        return new DevDomainFilterEmailProvider({ realProvider: real, allowedDomains });
      }
      return real;
    }
    if (!devSendAllowed()) {
      console.warn(
        `[Dune Email] DUNE_ENV=dev — refusing to construct the "${config.provider}" live provider, ` +
          "falling back to console. Set DUNE_EMAIL_ALLOW_DEV_SEND=1 to send real email in dev, " +
          "or DUNE_EMAIL_DEV_ALLOWED_DOMAINS to restrict real sends to specific domains.",
      );
      return new ConsoleEmailProvider();
    }
  }

  return createRawProvider(config, from);
}

function createRawProvider(config: EmailConfig, from: string): EmailProvider {
  switch (config.provider) {
    case "smtp": {
      if (!config.smtp) {
        console.warn(
          "[Dune Email] smtp provider selected but no smtp config found — falling back to console",
        );
        return new ConsoleEmailProvider();
      }
      return new SmtpEmailProvider({ ...config.smtp, from });
    }

    case "resend": {
      if (!config.resend?.apiKey) {
        console.warn(
          "[Dune Email] resend provider selected but no apiKey found — falling back to console",
        );
        return new ConsoleEmailProvider();
      }
      return new ResendEmailProvider({ apiKey: config.resend.apiKey, from });
    }

    case "postmark": {
      if (!config.postmark?.apiKey) {
        console.warn(
          "[Dune Email] postmark provider selected but no apiKey found — falling back to console",
        );
        return new ConsoleEmailProvider();
      }
      return new PostmarkEmailProvider({
        apiKey: config.postmark.apiKey,
        from,
      });
    }

    case "sendgrid": {
      if (!config.sendgrid?.apiKey) {
        console.warn(
          "[Dune Email] sendgrid provider selected but no apiKey found — falling back to console",
        );
        return new ConsoleEmailProvider();
      }
      return new SendGridEmailProvider({
        apiKey: config.sendgrid.apiKey,
        from,
      });
    }

    case "console":
    default:
      return new ConsoleEmailProvider();
  }
}
