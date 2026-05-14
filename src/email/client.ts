/**
 * Email client — the public `email.send()` surface.
 *
 * Accepts either raw HTML or a named template, resolves the message,
 * and dispatches to the configured EmailProvider.
 */

import type { StorageAdapter } from "../storage/types.ts";
import type { EmailMessage, EmailProvider } from "./types.ts";
import { loadTemplate } from "./templates.ts";

/** Options for a single email send operation. */
export interface SendOptions {
  /** Recipient address or array of addresses. */
  to: string | string[];
  /**
   * Email subject.
   * Required when `html` is provided directly and no template is used.
   * Ignored when a `template` is specified and the template provides its own subject.
   * When both are set, `subject` acts as a fallback if the template returns no subject.
   */
  subject?: string;
  /**
   * Name of the email template to render (without extension).
   * Templates are looked up in the `emailsDir` directory.
   * Mutually exclusive with `html` — at least one must be provided.
   */
  template?: string;
  /** Data passed to the template renderer as its props / context. */
  data?: Record<string, unknown>;
  /**
   * Raw HTML body. Alternative to `template`.
   * When provided alongside `template`, the template takes precedence for
   * HTML and subject; `html` is ignored.
   */
  html?: string;
  /**
   * Plain-text fallback. When omitted, auto-generated from HTML by
   * stripping tags.
   */
  text?: string;
  /** Per-message from override. Defaults to the client's configured from address. */
  from?: string;
  /** Reply-To address. */
  replyTo?: string;
}

/** Public email sending interface. */
export interface EmailClient {
  send(opts: SendOptions): Promise<void>;
}

/**
 * Create an EmailClient bound to a provider and default from address.
 *
 * @param opts.provider   Configured email provider (smtp, resend, postmark, sendgrid, or console)
 * @param opts.from       Default from address for all outgoing messages
 * @param opts.storage    StorageAdapter for resolving template files (optional)
 * @param opts.emailsDir  Directory within storage to look for templates (default: "emails")
 */
export function createEmailClient(opts: {
  provider: EmailProvider;
  from: string;
  storage?: StorageAdapter;
  emailsDir?: string;
}): EmailClient {
  const { provider, from, storage, emailsDir = "emails" } = opts;

  return {
    async send(sendOpts: SendOptions): Promise<void> {
      let html: string;
      let subject: string;
      let text: string | undefined = sendOpts.text;

      if (sendOpts.template) {
        // Template path
        if (!storage) {
          throw new Error(
            `[Dune Email] Cannot render template "${sendOpts.template}": no StorageAdapter provided to createEmailClient`,
          );
        }

        const template = await loadTemplate(sendOpts.template, storage, emailsDir);

        if (!template) {
          throw new Error(
            `[Dune Email] Template not found: "${sendOpts.template}" (looked in "${emailsDir}/" with extensions .email.tsx, .email.md, .email.mdx)`,
          );
        }

        const rendered = await template.render(sendOpts.data ?? {});
        html = rendered.html;
        subject = sendOpts.subject ?? rendered.subject;
        text = sendOpts.text ?? rendered.text;
      } else if (sendOpts.html) {
        // Raw HTML path
        if (!sendOpts.subject) {
          throw new Error(
            "[Dune Email] send() requires either a `template` or both `subject` and `html`",
          );
        }
        html = sendOpts.html;
        subject = sendOpts.subject;
      } else {
        throw new Error(
          "[Dune Email] send() requires either a `template` or `html` (with `subject`)",
        );
      }

      const message: EmailMessage = {
        to: sendOpts.to,
        subject,
        html,
        ...(text !== undefined ? { text } : {}),
        from: sendOpts.from ?? from,
        ...(sendOpts.replyTo ? { replyTo: sendOpts.replyTo } : {}),
      };

      await provider.send(message);
    },
  };
}
