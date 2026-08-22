/**
 * Dev-mode domain-allowlist email provider — a safer middle ground between
 * "refuse all real sends under DUNE_ENV=dev" (the default) and
 * "DUNE_EMAIL_ALLOW_DEV_SEND=1 sends everything for real, no filtering."
 *
 * Wraps a real (configured) EmailProvider. On each send(), checks every
 * recipient's domain against an allowlist:
 *   - All recipients match  -> forwarded to the real provider, sent for real.
 *   - Any recipient doesn't -> the WHOLE message redirects to the console
 *     provider instead. Fail-closed rather than a partial send to just the
 *     matching recipients — a silently-dropped subset of recipients on a
 *     multi-recipient message would be worse than the message just not
 *     going out for real at all, and the console provider still makes it
 *     inspectable via the dev-email preview.
 *
 * Guards against a dev environment that's somehow been pointed at
 * production-like data (a seeded/cloned dataset, a bug) — even with
 * DUNE_EMAIL_ALLOW_DEV_SEND=1 set, real sends stay bounded to known-safe
 * domains instead of "everyone real credentials can reach."
 */

import type { EmailMessage, EmailProvider } from "../types.ts";
import { ConsoleEmailProvider } from "./console.ts";

function domainOf(address: string): string {
  const at = address.lastIndexOf("@");
  return at === -1 ? "" : address.slice(at + 1).trim().toLowerCase();
}

export interface DevDomainFilterEmailProviderOptions {
  /** Real provider to delegate to when every recipient's domain is allowed. */
  realProvider: EmailProvider;
  /** Allowed domains, exact match, case-insensitive. */
  allowedDomains: string[];
  /** Provider to redirect to when any recipient's domain isn't allowed. Defaults to a new ConsoleEmailProvider. */
  fallbackProvider?: EmailProvider;
}

export class DevDomainFilterEmailProvider implements EmailProvider {
  private readonly realProvider: EmailProvider;
  private readonly fallbackProvider: EmailProvider;
  private readonly allowedDomains: Set<string>;

  constructor(opts: DevDomainFilterEmailProviderOptions) {
    this.realProvider = opts.realProvider;
    this.fallbackProvider = opts.fallbackProvider ?? new ConsoleEmailProvider();
    this.allowedDomains = new Set(
      opts.allowedDomains.map((d) => d.trim().toLowerCase()).filter(Boolean),
    );
  }

  async send(message: EmailMessage): Promise<void> {
    const recipients = Array.isArray(message.to) ? message.to : [message.to];
    const disallowed = recipients.filter((r) => !this.allowedDomains.has(domainOf(r)));

    if (disallowed.length > 0) {
      console.warn(
        `[Dune Email] DUNE_ENV=dev — recipient(s) outside DUNE_EMAIL_DEV_ALLOWED_DOMAINS ` +
          `(${disallowed.join(", ")}) — redirecting entire message to console instead of sending for real.`,
      );
      return this.fallbackProvider.send(message);
    }

    return this.realProvider.send(message);
  }
}
