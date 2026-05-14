/**
 * Dune CMS email abstraction — public API.
 *
 * Provides a general `email.send()` surface for transactional email delivery
 * from plugins, route handlers, and TSX pages. Distinct from the admin-side
 * `SmtpNotificationConfig` used for form submission notifications.
 *
 * @example Basic usage
 * ```ts
 * import { createEmailClient, createEmailProvider } from "@dune/core/email";
 *
 * const provider = createEmailProvider({
 *   provider: "resend",
 *   from: "hello@example.com",
 *   resend: { apiKey: Deno.env.get("RESEND_API_KEY")! },
 * });
 *
 * const email = createEmailClient({ provider, from: "hello@example.com" });
 *
 * await email.send({
 *   to: "user@example.com",
 *   subject: "Welcome!",
 *   html: "<p>Thanks for joining.</p>",
 * });
 * ```
 *
 * @example With a template
 * ```ts
 * await email.send({
 *   to: user.email,
 *   template: "welcome",
 *   data: { name: user.name },
 * });
 * ```
 *
 * @module
 */

// Types
export type { EmailMessage, EmailProvider, EmailTemplate } from "./types.ts";

// Client
export { createEmailClient } from "./client.ts";
export type { EmailClient, SendOptions } from "./client.ts";

// Providers
export { createEmailProvider } from "./providers/mod.ts";
export type { EmailConfig } from "./providers/mod.ts";
export { ConsoleEmailProvider } from "./providers/console.ts";
export { SmtpEmailProvider } from "./providers/smtp.ts";
export { ResendEmailProvider } from "./providers/resend.ts";
export { PostmarkEmailProvider } from "./providers/postmark.ts";
export { SendGridEmailProvider } from "./providers/sendgrid.ts";

// Templates
export { loadTemplate, renderTemplate } from "./templates.ts";
