/**
 * HTTP webhook notification sender for form submissions.
 *
 * POSTs the full submission JSON to a configured URL. Optionally signs the
 * request body with an HMAC-SHA256 secret so the receiver can verify the
 * payload hasn't been tampered with.
 *
 * Secret values beginning with "$" are expanded from environment variables:
 *   secret: "$WEBHOOK_SECRET"  →  Deno.env.get("WEBHOOK_SECRET") ?? ""
 *
 * The receiver should:
 *   1. Read the raw request body
 *   2. Compute HMAC-SHA256 of the body using the shared secret
 *   3. Compare to the X-Dune-Signature header (constant-time comparison)
 */

import type { WebhookNotificationConfig } from "../config/types.ts";
import type { Submission } from "./submissions.ts";
import { assertOutboundUrlAllowed } from "../security/ssrf.ts";

/** Expand "$VAR" → env variable value. */
function envExpand(value: string): string {
  if (value.startsWith("$")) {
    return Deno.env.get(value.slice(1)) ?? "";
  }
  return value;
}

/**
 * POST a submission to the configured webhook URL.
 * Throws on non-2xx responses or network errors (caller should catch and log).
 */
export async function sendWebhookNotification(
  cfg: WebhookNotificationConfig,
  submission: Submission,
): Promise<void> {
  const body = JSON.stringify(submission);
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "User-Agent": "Dune-CMS/0.3",
  };

  const secret = cfg.secret ? envExpand(cfg.secret) : null;
  if (secret) {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sigBytes = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(body),
    );
    const sigHex = Array.from(new Uint8Array(sigBytes))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    headers["X-Dune-Signature"] = `sha256=${sigHex}`;
  }

  await assertOutboundUrlAllowed(cfg.url, {
    allowPrivateDestinations: cfg.allow_private === true,
  });
  const resp = await fetch(cfg.url, { method: "POST", headers, body, redirect: "manual" });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(
      `Webhook POST to ${cfg.url} failed: ${resp.status} ${resp.statusText}${text ? ` — ${text.slice(0, 200)}` : ""}`,
    );
  }
}
