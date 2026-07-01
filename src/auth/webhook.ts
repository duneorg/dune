/**
 * IdP webhook handler for external-jwt + authzStore:local mode.
 *
 * Handles user.deleted events from Clerk, Auth0, and generic providers.
 * On deletion, calls authz.disallowAllMatching() to revoke all tuples for
 * the deleted user — preventing stale tuple accumulation.
 *
 * Role-change sync is NOT handled here — fingerprint reconciliation in
 * mount.ts already handles that per-request within one JWT TTL.
 *
 * Signature verification:
 *   Clerk  — svix: HMAC-SHA256 of "{svix-id}.{svix-timestamp}.{rawBody}"
 *             validated against the v1,<base64> svix-signature header
 *   Auth0  — HMAC-SHA256 of raw body, x-hub-signature-256: sha256=<hex>
 *   Generic— HMAC-SHA256 of raw body, x-dune-signature: sha256=<hex>
 *             (or a configured header via webhookConfig.signatureHeader)
 */

import type { DuneAuthSystem } from "./authz.ts";
import { logger } from "../core/logger.ts";

export interface WebhookConfig {
  /** IdP provider type — determines signature verification format. */
  provider: "clerk" | "auth0" | "generic";
  /** Shared HMAC secret. May be a raw string or $ENV_VAR reference. */
  secret: string;
  /**
   * Custom signature header name for "generic" provider.
   * Default: "x-dune-signature"
   */
  signatureHeader?: string;
  /**
   * For the "generic" provider: whether to require the timestamp header
   * (`x-timestamp` by default) for replay protection.
   *
   * Defaults to `true` — requests without a timestamp header are rejected.
   * Set to `false` only for legacy providers that do not send a timestamp.
   */
  requireTimestamp?: boolean;
}

// ── Signature verification ────────────────────────────────────────────────────

/** Replay window for all timestamp-bearing webhooks: 5 minutes. */
const WEBHOOK_TOLERANCE_MS = 5 * 60 * 1000;

/**
 * Constant-time hex comparison.
 * Both strings must be the same length; returns false otherwise.
 */
function hexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function hmacHex(secret: string, message: string | Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret).slice(),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const data = typeof message === "string" ? new TextEncoder().encode(message) : message;
  const sig = await crypto.subtle.sign("HMAC", key, data.slice());
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Verify a Clerk/svix webhook signature.
 * Returns the raw body on success, null on failure.
 */
async function verifyClerk(req: Request, secret: string): Promise<Uint8Array | null> {
  const msgId = req.headers.get("svix-id");
  const msgTimestamp = req.headers.get("svix-timestamp");
  const msgSignature = req.headers.get("svix-signature");

  if (!msgId || !msgTimestamp || !msgSignature) return null;

  // Replay protection — reject stale webhooks.
  // Parse the timestamp carefully: Number("abc") = NaN, and NaN comparisons are
  // always false, which would silently skip the replay guard. We reject explicitly
  // when the parsed value is not finite.
  const tsSeconds = Number(msgTimestamp);
  if (!Number.isFinite(tsSeconds)) return null;
  const tsMs = tsSeconds * 1000;
  if (Math.abs(Date.now() - tsMs) > WEBHOOK_TOLERANCE_MS) return null;

  const body = new Uint8Array(await req.arrayBuffer());
  const toSign = `${msgId}.${msgTimestamp}.${new TextDecoder().decode(body)}`;
  const expected = await hmacHex(secret, toSign);

  // svix-signature may contain multiple space-separated "v1,<base64>" signatures
  const signatures = msgSignature.split(" ");
  for (const sig of signatures) {
    if (!sig.startsWith("v1,")) continue;
    const b64 = sig.slice(3);
    // Decode base64 to hex for comparison
    try {
      const raw = atob(b64);
      const hex = Array.from(raw).map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
      if (hexEqual(expected, hex)) return body;
    } catch { /* invalid base64 */ }
  }
  return null;
}

/**
 * Verify an Auth0 or generic webhook using x-hub-signature-256 style.
 *
 * Replay protection: checks `timestampHeader` when provided. Auth0 sends
 * `x-auth0-timestamp` (Unix seconds); generic provider uses `x-timestamp`.
 * If the header is absent we cannot check staleness — the HMAC signature
 * still protects authenticity but replay is possible if the secret is exposed.
 *
 * Returns the raw body on success, null on failure.
 */
async function verifyHubSignature(
  req: Request,
  secret: string,
  headerName: string,
  timestampHeader?: string,
  requireTimestampWhenConfigured = true,
): Promise<Uint8Array | null> {
  const sigHeader = req.headers.get(headerName);
  if (!sigHeader) return null;

  const prefix = "sha256=";
  if (!sigHeader.startsWith(prefix)) return null;
  const provided = sigHeader.slice(prefix.length);

  // Replay protection — enforced whenever timestampHeader is configured.
  // M6: When a timestamp header is configured but absent in the request, we now
  // reject rather than silently skipping — preventing indefinite replay of captured
  // valid-signature payloads. Pass requireTimestamp=false to opt out for legacy
  // providers that do not send a timestamp.
  // Number("abc") = NaN and NaN comparisons always return false, so we must
  // check isFinite explicitly to avoid silently skipping the guard.
  if (timestampHeader) {
    const tsRaw = req.headers.get(timestampHeader);
    if (tsRaw === null) {
      // Timestamp header configured but absent in request — reject to prevent replays.
      if (requireTimestampWhenConfigured) return null;
    } else {
      const tsSeconds = Number(tsRaw);
      if (!Number.isFinite(tsSeconds)) return null;
      if (Math.abs(Date.now() / 1000 - tsSeconds) > WEBHOOK_TOLERANCE_MS / 1000) return null;
    }
  }

  const body = new Uint8Array(await req.arrayBuffer());
  const expected = await hmacHex(secret, body);

  return hexEqual(expected, provided) ? body : null;
}

// ── Event parsing ─────────────────────────────────────────────────────────────

type ProviderEvent = "user.deleted" | "unknown";

interface ParsedEvent {
  type: ProviderEvent;
  userId: string | null;
}

function parseClerkEvent(payload: Record<string, unknown>): ParsedEvent {
  const type = payload.type as string;
  if (type === "user.deleted") {
    const data = payload.data as Record<string, unknown> | undefined;
    return { type: "user.deleted", userId: (data?.id as string) ?? null };
  }
  return { type: "unknown", userId: null };
}

function parseAuth0Event(payload: Record<string, unknown>): ParsedEvent {
  // Auth0 Management API webhook format varies by event.
  // user_deleted event: { event: "user_deleted", data: { user_id: "auth0|..." } }
  const event = (payload.event as string) ?? (payload.type as string);
  if (event === "user_deleted" || event === "user.deleted") {
    const data = (payload.data as Record<string, unknown>) ?? payload;
    const userId = (data.user_id ?? data.id ?? null) as string | null;
    return { type: "user.deleted", userId };
  }
  return { type: "unknown", userId: null };
}

function parseGenericEvent(payload: Record<string, unknown>): ParsedEvent {
  const type = (payload.type as string) ?? (payload.event as string);
  if (type === "user.deleted" || type === "user_deleted") {
    const data = (payload.data as Record<string, unknown>) ?? payload;
    const userId = (data.id ?? data.user_id ?? null) as string | null;
    return { type: "user.deleted", userId };
  }
  return { type: "unknown", userId: null };
}

// ── Main handler ──────────────────────────────────────────────────────────────

export interface WebhookHandlerDeps {
  config: WebhookConfig;
  authz: DuneAuthSystem;
  /** Optional: write structured audit log entries. */
  auditLog?: (event: string, data: Record<string, unknown>) => void;
}

/**
 * Handle a POST /auth/webhook request.
 *
 * - Verifies the provider signature
 * - Parses the event type
 * - For user.deleted: revokes all authz tuples for that user
 * - Returns appropriate HTTP status
 */
export async function handleWebhook(req: Request, deps: WebhookHandlerDeps): Promise<Response> {
  const { config, authz, auditLog } = deps;

  // ── Signature verification ──────────────────────────────────────────────────
  let body: Uint8Array | null = null;

  switch (config.provider) {
    case "clerk":
      body = await verifyClerk(req, config.secret);
      break;
    case "auth0":
      // Auth0 Management API sends x-auth0-timestamp (Unix seconds).
      body = await verifyHubSignature(req, config.secret, "x-hub-signature-256", "x-auth0-timestamp");
      break;
    case "generic":
      // Generic provider: timestamp header required by default (M6: reject when absent
      // to prevent replay attacks). Set config.requireTimestamp = false to opt out
      // for legacy providers that do not send a timestamp.
      body = await verifyHubSignature(
        req,
        config.secret,
        config.signatureHeader ?? "x-dune-signature",
        "x-timestamp",
        config.requireTimestamp !== false,
      );
      break;
  }

  if (body === null) {
    return new Response(JSON.stringify({ error: "Invalid signature" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── Event parsing ───────────────────────────────────────────────────────────
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const parsedEvent =
    config.provider === "clerk"
      ? parseClerkEvent(payload)
      : config.provider === "auth0"
      ? parseAuth0Event(payload)
      : parseGenericEvent(payload);

  // ── Event dispatch ──────────────────────────────────────────────────────────
  if (parsedEvent.type === "user.deleted") {
    const userId = parsedEvent.userId;
    if (!userId) {
      return new Response(JSON.stringify({ error: "Missing user id in payload" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const count = await authz.disallowAllMatching({
        who: { type: "user", id: userId },
      });

      auditLog?.("authz.webhook_delete", {
        provider: config.provider,
        userId,
        tuplesRevoked: count,
      });

      logger.info("auth.webhook.user_deleted", {
        provider: config.provider,
        userId,
        tuplesRevoked: count,
      });
    } catch (err) {
      logger.error("auth.webhook.revoke_failed", {
        provider: config.provider,
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
      return new Response(JSON.stringify({ error: "Internal error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }
  // All other event types (role changes, session revocations) are no-ops —
  // fingerprint reconciliation in mount.ts handles role sync per-request.

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
