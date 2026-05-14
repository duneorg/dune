/**
 * Stripe payment provider implementation.
 *
 * Uses Stripe's REST API directly via native fetch — no Stripe SDK dependency.
 * All requests are authenticated with HTTP Basic auth (secretKey as username,
 * empty password), which is how Stripe encodes Bearer tokens in Basic auth.
 *
 * Webhook verification follows the Stripe signature scheme:
 *   HMAC-SHA256 of "{timestamp}.{rawBody}" verified against the v1= value
 *   in the Stripe-Signature header.
 */

/** @module */

import { encodeBase64 } from "@std/encoding/base64";
import { encodeHex } from "@std/encoding/hex";
import type { CheckoutSession, PaymentProvider, Product, WebhookEvent } from "./types.ts";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Build the Authorization header value for Stripe Basic auth. */
function stripeAuth(secretKey: string): string {
  // Stripe accepts "Basic base64(secretKey:)" — note the trailing colon.
  const credentials = new TextEncoder().encode(`${secretKey}:`);
  return `Basic ${encodeBase64(credentials)}`;
}

/** Encode an object as application/x-www-form-urlencoded for Stripe API calls. */
function encodeForm(data: Record<string, string | undefined>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
    }
  }
  return parts.join("&");
}

/**
 * Compute HMAC-SHA256 and return the lowercase hex digest.
 * Used for Stripe webhook signature verification.
 */
async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const keyBytes = new TextEncoder().encode(key);
  const msgBytes = new TextEncoder().encode(message);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign("HMAC", cryptoKey, msgBytes);
  return encodeHex(new Uint8Array(signature));
}

// ---------------------------------------------------------------------------
// Stripe provider
// ---------------------------------------------------------------------------

export interface StripePaymentProviderConfig {
  /** Stripe secret key (sk_live_xxx or sk_test_xxx). */
  secretKey: string;
}

/**
 * Creates a PaymentProvider backed by the Stripe Payments API.
 *
 * @example
 * ```ts
 * const provider = createStripePaymentProvider({ secretKey: Deno.env.get("STRIPE_SECRET_KEY")! });
 * ```
 */
export function createStripePaymentProvider(
  config: StripePaymentProviderConfig,
): PaymentProvider {
  const { secretKey } = config;
  const authHeader = stripeAuth(secretKey);

  /**
   * POST to Stripe API with form-encoded body.
   * Throws if the response is not 2xx.
   */
  async function stripePost(
    path: string,
    body: Record<string, string | undefined>,
  ): Promise<unknown> {
    const response = await fetch(`https://api.stripe.com${path}`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: encodeForm(body),
    });

    const json = await response.json();

    if (!response.ok) {
      const message = (json as { error?: { message?: string } })?.error?.message ??
        `Stripe API error ${response.status}`;
      throw new Error(message);
    }

    return json;
  }

  async function createCheckoutSession(opts: {
    product: Product;
    userId: string;
    userEmail: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<CheckoutSession> {
    const mode = opts.product.mode ?? "subscription";

    const body: Record<string, string | undefined> = {
      mode,
      customer_email: opts.userEmail,
      success_url: opts.successUrl,
      cancel_url: opts.cancelUrl,
      // Line items: single price from the product definition
      "line_items[0][price]": opts.product.priceId,
      "line_items[0][quantity]": "1",
      // Metadata allows the webhook handler to resolve the Dune user and product
      "metadata[userId]": opts.userId,
      "metadata[productId]": opts.product.id,
    };

    const session = await stripePost("/v1/checkout/sessions", body) as {
      id: string;
      url: string;
    };

    return {
      url: session.url,
      sessionId: session.id,
    };
  }

  async function parseWebhook(
    req: Request,
    secret: string,
  ): Promise<WebhookEvent | null> {
    // Stripe-Signature: t=<timestamp>,v1=<hex>,v1=<hex>,...
    const sigHeader = req.headers.get("stripe-signature");
    if (!sigHeader) return null;

    // Read the raw body once — we need it for signature verification and parsing.
    let rawBody: string;
    try {
      rawBody = await req.text();
    } catch {
      return null;
    }

    // Parse the Stripe-Signature header into { t, v1 }
    const parts: Record<string, string> = {};
    for (const part of sigHeader.split(",")) {
      const eq = part.indexOf("=");
      if (eq === -1) continue;
      const k = part.slice(0, eq).trim();
      const v = part.slice(eq + 1).trim();
      // Keep only the first occurrence of each key
      if (!(k in parts)) parts[k] = v;
    }

    const timestamp = parts["t"];
    const expectedSig = parts["v1"];

    if (!timestamp || !expectedSig) return null;

    // Reject stale webhooks to prevent replay attacks.
    // Stripe's own SDK uses a 300-second (5-minute) tolerance.
    const webhookAge = Math.abs(Date.now() / 1000 - Number(timestamp));
    if (!Number.isFinite(webhookAge) || webhookAge > 300) return null;

    // Stripe signs: "{timestamp}.{rawBody}"
    const signedPayload = `${timestamp}.${rawBody}`;
    const computedSig = await hmacSha256Hex(secret, signedPayload);

    // Constant-time comparison: compare the hex strings character by character
    if (!timingSafeEqual(computedSig, expectedSig)) return null;

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return null;
    }

    const type = typeof payload["type"] === "string" ? payload["type"] : "unknown";
    const event: WebhookEvent = { type, raw: payload };

    // Resolve Dune-specific fields for checkout.session.completed
    if (type === "checkout.session.completed") {
      const obj = (payload["data"] as Record<string, unknown> | undefined)?.["object"] as
        | Record<string, unknown>
        | undefined;

      if (obj) {
        const metadata = obj["metadata"] as Record<string, string> | undefined;
        event.userId = metadata?.["userId"];
        event.productId = metadata?.["productId"];

        const customerId = obj["customer"];
        if (typeof customerId === "string") {
          event.customerId = customerId;
        }
      }
    }

    return event;
  }

  async function createPortalSession(opts: {
    customerId: string;
    returnUrl: string;
  }): Promise<{ url: string }> {
    const session = await stripePost("/v1/billing_portal/sessions", {
      customer: opts.customerId,
      return_url: opts.returnUrl,
    }) as { url: string };

    return { url: session.url };
  }

  return { createCheckoutSession, parseWebhook, createPortalSession };
}

// ---------------------------------------------------------------------------
// Timing-safe string comparison
// ---------------------------------------------------------------------------

/**
 * Compare two hex strings in constant time to prevent timing attacks.
 * Returns true only when both strings are identical in length and content.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
