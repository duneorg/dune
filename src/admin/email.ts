/**
 * Email notification sender for form submissions.
 *
 * Uses nodemailer for SMTP transport. String config values beginning with "$"
 * are expanded to their corresponding environment variable at send time:
 *
 *   pass: "$SMTP_PASSWORD"  →  Deno.env.get("SMTP_PASSWORD") ?? ""
 *
 * Sending is fire-and-forget from the contact handler perspective — errors are
 * logged but never bubble up to the submitter.
 */

// @ts-types="npm:@types/nodemailer@^6"
import nodemailer from "nodemailer";
import type { SmtpNotificationConfig } from "../config/types.ts";
import type { Submission } from "./submissions.ts";

/**
 * Expand a config string value: if it starts with "$", substitute the
 * named environment variable. Returns an empty string when the variable is
 * not set (rather than throwing) so misconfigured deployments degrade
 * gracefully instead of crashing.
 */
function envExpand(value: string): string {
  if (value.startsWith("$")) {
    return Deno.env.get(value.slice(1)) ?? "";
  }
  return value;
}

/**
 * Send an email notification for a new form submission.
 * Throws on transport or authentication errors (caller should catch and log).
 */
export async function sendSubmissionEmail(
  cfg: SmtpNotificationConfig,
  submission: Submission,
): Promise<void> {
  const transporter = nodemailer.createTransport({
    host: cfg.smtp.host,
    port: cfg.smtp.port,
    secure: cfg.smtp.secure,
    auth: {
      user: envExpand(cfg.smtp.user),
      pass: envExpand(cfg.smtp.pass),
    },
  });

  const subject = (cfg.subject ?? "New {form} submission")
    .replace(/\{form\}/g, submission.form);

  const to = Array.isArray(cfg.to) ? cfg.to.join(", ") : cfg.to;

  // Plain-text body
  const fieldLines = Object.entries(submission.fields)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  const receivedStr = new Date(submission.receivedAt).toISOString();
  const text = [
    `New submission received for form: ${submission.form}`,
    `Received: ${receivedStr}`,
    `ID: ${submission.id}`,
    "",
    "Fields:",
    fieldLines,
    ...(submission.files && submission.files.length > 0
      ? ["", "Attachments:", ...submission.files.map((f) => `  ${f.name} (${f.contentType}, ${f.size} bytes)`)]
      : []),
  ].join("\n");

  // HTML body
  const fieldRows = Object.entries(submission.fields)
    .map(([k, v]) => `<tr><th style="text-align:left;padding:4px 8px;background:#f5f5f5">${escHtml(k)}</th><td style="padding:4px 8px">${escHtml(v)}</td></tr>`)
    .join("");
  const fileRows = (submission.files ?? [])
    .map((f) => `<tr><th style="text-align:left;padding:4px 8px;background:#f5f5f5">attachment</th><td style="padding:4px 8px">${escHtml(f.name)} (${escHtml(f.contentType)}, ${f.size} bytes)</td></tr>`)
    .join("");

  const html = `
<div style="font-family:system-ui,sans-serif;max-width:600px">
  <h2 style="color:#1a1a2e">New ${escHtml(submission.form)} submission</h2>
  <p style="color:#666;font-size:0.9em">Received ${escHtml(receivedStr)} — ID: ${escHtml(submission.id)}</p>
  <table style="width:100%;border-collapse:collapse;border:1px solid #e0e0e0">
    ${fieldRows}${fileRows}
  </table>
</div>`.trim();

  await transporter.sendMail({ from: cfg.from, to, subject, text, html });
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
