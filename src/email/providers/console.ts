/**
 * Console email provider — development/testing only.
 *
 * Logs emails to stdout instead of sending them. Auto-selected when no
 * email provider is configured in site.yaml.
 */

import type { EmailMessage, EmailProvider } from "../types.ts";

/** Dev-mode provider that prints emails to stdout instead of sending them. */
export class ConsoleEmailProvider implements EmailProvider {
  async send(message: EmailMessage): Promise<void> {
    const to = Array.isArray(message.to) ? message.to.join(", ") : message.to;
    const divider = "─".repeat(60);

    console.log(`\n${divider}`);
    console.log("[Dune Email] CONSOLE PROVIDER — not actually sent");
    console.log(`  To:      ${to}`);
    if (message.from) console.log(`  From:    ${message.from}`);
    if (message.replyTo) console.log(`  Reply-To: ${message.replyTo}`);
    console.log(`  Subject: ${message.subject}`);
    console.log(`  HTML:\n${message.html}`);
    if (message.text) console.log(`  Text:\n${message.text}`);
    console.log(`${divider}\n`);

    // Satisfy the async signature without blocking
    await Promise.resolve();
  }
}
