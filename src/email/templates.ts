/**
 * Email template engine.
 *
 * Templates live in the `emails/` directory at the project root.
 * Three formats are supported:
 *
 *   emails/welcome.email.tsx  — JSX component rendered via preact-render-to-string
 *   emails/welcome.email.md   — Markdown with {{placeholder}} substitution;
 *                               subject taken from the first # Heading
 *   emails/welcome.email.mdx  — treated as Markdown (noted limitation)
 */

import { Marked } from "marked";
import { render as renderToString } from "preact-render-to-string";
import { h } from "preact";
import type { StorageAdapter } from "../storage/types.ts";
import type { EmailTemplate } from "./types.ts";

/** Supported template file extensions, ordered by lookup priority. */
const EXTENSIONS = [".email.tsx", ".email.md", ".email.mdx"] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Strip HTML tags from a string to produce plain text. */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Escape HTML special characters in a string.
 *
 * Applied to interpolated values in Markdown/HTML email templates to prevent
 * user-controlled data (e.g. display names, email addresses) from injecting
 * raw HTML into the generated email.
 */
function escHtmlValue(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Replace `{{key}}` placeholders with values from `data`.
 *
 * Values are HTML-escaped before insertion. This prevents user-controlled
 * data (names, emails, etc.) from injecting raw HTML into Markdown templates
 * whose output is rendered as HTML by the email client.
 *
 * Unknown keys are left as-is (the `{{key}}` literal).
 */
function interpolate(template: string, data: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      return escHtmlValue(String(data[key]));
    }
    return `{{${key}}}`;
  });
}

// ─── Markdown template ────────────────────────────────────────────────────────

function buildMarkdownTemplate(name: string, source: string): EmailTemplate {
  return {
    name,
    async render(data: Record<string, unknown>) {
      const interpolated = interpolate(source, data);

      // Extract subject from the first # Heading line
      const headingMatch = interpolated.match(/^#\s+(.+)$/m);
      const subject = headingMatch ? headingMatch[1].trim() : name;

      // Remove the heading from body so it doesn't appear twice
      const body = headingMatch
        ? interpolated.replace(/^#\s+.+\n?/m, "").trim()
        : interpolated;

      const marked = new Marked();
      const html = await marked.parse(body);
      const text = stripHtml(html);

      return { html, subject, text };
    },
  };
}

// ─── TSX template ─────────────────────────────────────────────────────────────

function buildTsxTemplate(name: string, filePath: string): EmailTemplate {
  return {
    name,
    async render(data: Record<string, unknown>) {
      // Dynamically import the TSX component at render time
      const mod = await import(filePath);
      const Component = mod.default;

      if (typeof Component !== "function") {
        throw new Error(
          `Email template "${name}" default export is not a function (got ${typeof Component})`,
        );
      }

      // Render JSX component to HTML string
      const html = renderToString(h(Component, data as Record<string, unknown>));

      // Subject can be exported as a named export from the module, or falls back to the template name
      const subject: string = typeof mod.subject === "string"
        ? mod.subject
        : typeof mod.subject === "function"
        ? String(mod.subject(data))
        : name;

      const text = stripHtml(html);

      return { html, subject, text };
    },
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Load an email template by name from the emails directory.
 *
 * The lookup tries extensions in order: `.email.tsx`, `.email.md`, `.email.mdx`.
 * Returns `null` when no matching template file is found.
 *
 * @param templateName  Template name without extension (e.g. "welcome")
 * @param storage       StorageAdapter rooted at the site root
 * @param emailsDir     Path to the emails directory relative to storage root
 *                      (default: "emails")
 */
export async function loadTemplate(
  templateName: string,
  storage: StorageAdapter,
  emailsDir = "emails",
): Promise<EmailTemplate | null> {
  for (const ext of EXTENSIONS) {
    const relativePath = `${emailsDir}/${templateName}${ext}`;

    const exists = await storage.exists(relativePath).catch(() => false);
    if (!exists) continue;

    if (ext === ".email.tsx") {
      // For TSX we need an absolute filesystem path for dynamic import()
      // We read the text first just to confirm the file exists; the actual
      // rendering uses dynamic import() with the resolved absolute path.
      // The storage adapter's root is not directly accessible here, so we
      // reconstruct the absolute path via Deno.cwd() fallback strategy.
      // Callers running in a real site context should pass an emailsDir that
      // resolves correctly relative to cwd.
      const absolutePath = new URL(
        relativePath,
        `file://${Deno.cwd()}/`,
      ).href;
      return buildTsxTemplate(templateName, absolutePath);
    }

    // For .md and .mdx: read source and build markdown template
    const source = await storage.readText(relativePath);
    return buildMarkdownTemplate(templateName, source);
  }

  return null;
}

/**
 * Render an already-loaded template with the supplied data.
 *
 * This is a convenience wrapper around `template.render(data)` that
 * ensures consistent error messaging.
 */
export async function renderTemplate(
  template: EmailTemplate,
  data: Record<string, unknown>,
): Promise<{ html: string; subject: string; text?: string }> {
  return await template.render(data);
}
