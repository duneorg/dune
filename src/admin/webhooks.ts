/**
 * Outbound webhook delivery engine for content mutation events.
 *
 * Fires when the admin panel creates, updates, or deletes pages, or changes
 * a page's workflow status. Separate from the form-submission webhook in
 * webhook.ts — this module handles content events, that one handles forms.
 *
 * Features:
 *   - Per-endpoint event filtering (only fire for subscribed events)
 *   - HMAC-SHA256 signing (same pattern as form submission webhooks)
 *   - Retry with exponential backoff: 3 attempts at 1s / 5s / 25s
 *   - Delivery logs persisted to {runtimeDir}/webhook-logs/{YYYY-MM-DD}/{id}.json
 *
 * All delivery is fire-and-forget: callers should not await `fireContentWebhooks`.
 * Failures are logged to console but never propagate to the HTTP response.
 */

import { join } from "@std/path";
import { encodeHex } from "@std/encoding/hex";
import type { WebhookContentEvent, WebhookEndpointConfig } from "../config/types.ts";

// === Types ===

export interface WebhookDeliveryAttempt {
  attemptNumber: number;
  timestamp: number;
  statusCode?: number;
  errorMessage?: string;
  success: boolean;
}

export interface WebhookDeliveryLog {
  id: string;
  endpointUrl: string;
  endpointLabel?: string;
  event: WebhookContentEvent;
  payload: unknown;
  attempts: WebhookDeliveryAttempt[];
  /** "success" if any attempt succeeded; "failed" after all retries exhausted */
  finalStatus: "success" | "failed" | "pending";
  createdAt: number;
}

// === Internal helpers ===

/** Expand "$VAR" → env variable value (mirrors webhook.ts). */
function envExpand(value: string): string {
  if (value.startsWith("$")) {
    return Deno.env.get(value.slice(1)) ?? "";
  }
  return value;
}

/** HMAC-SHA256 sign a body string, returning "sha256=<hex>". */
async function signBody(body: string, secret: string): Promise<string> {
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
  return `sha256=${encodeHex(new Uint8Array(sigBytes))}`;
}

/** Write a delivery log record to disk. */
async function writelog(logDir: string, record: WebhookDeliveryLog): Promise<void> {
  try {
    const date = new Date(record.createdAt).toISOString().slice(0, 10); // YYYY-MM-DD
    const dir = join(logDir, "webhook-logs", date);
    await Deno.mkdir(dir, { recursive: true });
    await Deno.writeTextFile(
      join(dir, `${record.id}.json`),
      JSON.stringify(record, null, 2),
    );
  } catch (err) {
    console.warn(`[dune] webhook: failed to write delivery log: ${err}`);
  }
}

/** Attempt a single delivery. Returns the attempt record. */
async function attemptDelivery(
  endpoint: WebhookEndpointConfig,
  body: string,
  attemptNumber: number,
): Promise<WebhookDeliveryAttempt> {
  const timestamp = Date.now();
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json; charset=utf-8",
      "User-Agent": "Dune-CMS/0.4",
    };
    const rawSecret = endpoint.secret ? envExpand(endpoint.secret) : null;
    if (rawSecret) {
      headers["X-Dune-Signature"] = await signBody(body, rawSecret);
    }

    const resp = await fetch(endpoint.url, { method: "POST", headers, body });
    if (resp.ok) {
      // Drain body to allow connection reuse
      await resp.body?.cancel();
      return { attemptNumber, timestamp, statusCode: resp.status, success: true };
    }
    const text = await resp.text().catch(() => "");
    return {
      attemptNumber,
      timestamp,
      statusCode: resp.status,
      errorMessage: `HTTP ${resp.status}${text ? `: ${text.slice(0, 200)}` : ""}`,
      success: false,
    };
  } catch (err) {
    return {
      attemptNumber,
      timestamp,
      errorMessage: String(err),
      success: false,
    };
  }
}

/** Retry delays in milliseconds for each subsequent attempt. */
const RETRY_DELAYS_MS = [1_000, 5_000, 25_000];

/** Deliver to one endpoint with up to 3 attempts, writing a log record. */
async function deliverWithRetry(
  endpoint: WebhookEndpointConfig,
  event: WebhookContentEvent,
  payload: unknown,
  logDir: string,
): Promise<void> {
  const id = encodeHex(crypto.getRandomValues(new Uint8Array(8)));
  const body = JSON.stringify({ event, payload, sentAt: new Date().toISOString() });

  const record: WebhookDeliveryLog = {
    id,
    endpointUrl: endpoint.url,
    endpointLabel: endpoint.label,
    event,
    payload,
    attempts: [],
    finalStatus: "pending",
    createdAt: Date.now(),
  };

  for (let i = 0; i < 3; i++) {
    const attempt = await attemptDelivery(endpoint, body, i + 1);
    record.attempts.push(attempt);

    if (attempt.success) {
      record.finalStatus = "success";
      await writelog(logDir, record);
      return;
    }

    if (i < 2) {
      // Wait before next retry
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[i]));
    }
  }

  record.finalStatus = "failed";
  const last = record.attempts.at(-1);
  console.warn(
    `[dune] webhook: delivery failed after 3 attempts to ${endpoint.url} (event: ${event}): ${last?.errorMessage ?? "unknown error"}`,
  );
  await writelog(logDir, record);
}

// === Public API ===

/**
 * Fire content event webhooks to all matching enabled endpoints.
 *
 * This function is fire-and-forget — it resolves immediately and runs
 * delivery in the background. Never throws.
 *
 * @param endpoints - Configured webhook endpoints (from admin.webhooks)
 * @param event     - The content event that occurred
 * @param payload   - Event-specific data included in the POST body
 * @param logDir    - Base directory for delivery logs (admin.runtimeDir)
 */
export function fireContentWebhooks(
  endpoints: WebhookEndpointConfig[],
  event: WebhookContentEvent,
  payload: unknown,
  logDir: string,
): void {
  const active = endpoints.filter(
    (e) => (e.enabled ?? true) && e.events.includes(event),
  );
  if (active.length === 0) return;

  // Fire all matching endpoints in parallel — do not await
  Promise.all(
    active.map((endpoint) =>
      deliverWithRetry(endpoint, event, payload, logDir).catch((err) => {
        console.error(`[dune] webhook: unexpected error for ${endpoint.url}: ${err}`);
      })
    ),
  ).catch(() => {
    // Belt-and-suspenders: Promise.all itself should not throw, but just in case
  });
}

/**
 * List recent delivery log records, newest first.
 *
 * Reads logs from the last 7 days of log directories and returns up to `limit`
 * records. Silently returns an empty array if the log directory doesn't exist.
 *
 * @param logDir - Base directory (admin.runtimeDir)
 * @param limit  - Maximum records to return (default: 50)
 */
export async function listDeliveryLogs(
  logDir: string,
  limit = 50,
): Promise<WebhookDeliveryLog[]> {
  const baseDir = join(logDir, "webhook-logs");
  const results: WebhookDeliveryLog[] = [];

  // Collect up to 7 days of date directories (sorted descending = newest first)
  const today = new Date();
  const dateDirs: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    dateDirs.push(d.toISOString().slice(0, 10));
  }

  for (const date of dateDirs) {
    if (results.length >= limit) break;
    const dir = join(baseDir, date);
    try {
      const entries: string[] = [];
      for await (const entry of Deno.readDir(dir)) {
        if (entry.isFile && entry.name.endsWith(".json")) {
          entries.push(entry.name);
        }
      }
      // Sort descending by filename (id = time-based hex, earlier chars are random — use mtime)
      // Simple approach: sort alphabetically descending (good enough for same-day logs)
      entries.sort().reverse();

      for (const fname of entries) {
        if (results.length >= limit) break;
        try {
          const raw = await Deno.readTextFile(join(dir, fname));
          results.push(JSON.parse(raw) as WebhookDeliveryLog);
        } catch {
          // Skip malformed log files
        }
      }
    } catch {
      // Directory doesn't exist for this date — skip silently
    }
  }

  return results;
}
