/**
 * Console email provider — development/testing only.
 *
 * Logs emails to stdout instead of sending them. Auto-selected when no
 * email provider is configured in site.yaml.
 *
 * In development (DUNE_ENV=dev), emails are also written as JSON files to
 * `devEmailDir` (default: `.dune/admin/dev-email/`). The admin panel serves
 * these at `/admin/email-preview` for easy inspection without SSH access.
 */

import { join } from "@std/path";
import type { EmailMessage, EmailProvider } from "../types.ts";

export interface ConsoleEmailProviderOptions {
  /**
   * Directory to write intercepted email files into.
   * Only active when DUNE_ENV=dev.
   * Defaults to `{cwd}/.dune/admin/dev-email` — matches the standard runtimeDir layout.
   */
  devEmailDir?: string;
}

/** Dev-mode provider that prints emails to stdout and optionally captures them to disk. */
export class ConsoleEmailProvider implements EmailProvider {
  private readonly devEmailDir: string | null;

  constructor(opts?: ConsoleEmailProviderOptions) {
    const isDev = Deno.env.get("DUNE_ENV") === "dev";
    this.devEmailDir = isDev
      ? (opts?.devEmailDir
          ?? Deno.env.get("DUNE_DEV_EMAIL_DIR")   // set by serve.ts from configured runtimeDir
          ?? join(Deno.cwd(), ".dune", "admin", "dev-email"))
      : null;
  }

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

    // In dev mode, persist the email to disk so the admin preview UI can show it.
    if (this.devEmailDir) {
      try {
        await Deno.mkdir(this.devEmailDir, { recursive: true });
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const record = {
          id,
          to,
          from: message.from ?? null,
          subject: message.subject,
          timestamp: Date.now(),
          html: message.html,
          text: message.text ?? null,
        };
        await Deno.writeTextFile(
          join(this.devEmailDir, `${id}.json`),
          JSON.stringify(record, null, 2),
        );
      } catch (err) {
        // Non-fatal — stdout logging already succeeded
        console.warn("[Dune Email] Failed to write dev-email file:", err);
      }
    }
  }
}
