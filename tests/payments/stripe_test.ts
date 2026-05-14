/**
 * Unit tests for StripePaymentProvider.
 *
 * All Stripe API calls are intercepted by overriding the global fetch.
 * HMAC signatures are computed using the same algorithm as the provider so
 * we can craft both valid and invalid webhook payloads deterministically.
 */

import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { encodeBase64 } from "@std/encoding/base64";
import { encodeHex } from "@std/encoding/hex";
import { createStripePaymentProvider } from "../../src/payments/stripe.ts";
import type { Product } from "../../src/payments/types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SECRET_KEY = "sk_test_abc123";
const WEBHOOK_SECRET = "whsec_test_secret";

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: "membership",
    name: "Monthly Membership",
    priceId: "price_test_123",
    role: "member",
    mode: "subscription",
    ...overrides,
  };
}

/** Compute HMAC-SHA256 hex the same way the provider does. */
async function computeStripeSignature(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return encodeHex(new Uint8Array(sig));
}

/** Build a Request with a valid Stripe-Signature header for the given body. */
async function makeWebhookRequest(
  body: string,
  secret: string,
  opts: { wrongSig?: boolean; omitHeader?: boolean } = {},
): Promise<Request> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signedPayload = `${timestamp}.${body}`;
  const sig = opts.wrongSig
    ? "0000000000000000000000000000000000000000000000000000000000000000"
    : await computeStripeSignature(secret, signedPayload);

  const headers: Record<string, string> = {
    "content-type": "application/json",
  };

  if (!opts.omitHeader) {
    headers["stripe-signature"] = `t=${timestamp},v1=${sig}`;
  }

  return new Request("http://example.com/payments/webhook", {
    method: "POST",
    headers,
    body,
  });
}

// ---------------------------------------------------------------------------
// createCheckoutSession
// ---------------------------------------------------------------------------

Deno.test("createCheckoutSession: builds correct request body", async () => {
  const product = makeProduct();
  const capturedRequests: Request[] = [];
  const capturedBodies: string[] = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input, init);
    capturedRequests.push(req);
    const body = await req.text();
    capturedBodies.push(body);

    return new Response(
      JSON.stringify({ id: "cs_test_abc", url: "https://checkout.stripe.com/pay/cs_test_abc" }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const provider = createStripePaymentProvider({ secretKey: SECRET_KEY });

    const session = await provider.createCheckoutSession({
      product,
      userId: "user-123",
      userEmail: "user@example.com",
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
    });

    assertEquals(session.sessionId, "cs_test_abc");
    assertEquals(session.url, "https://checkout.stripe.com/pay/cs_test_abc");
    assertEquals(capturedRequests.length, 1);

    const req = capturedRequests[0];
    assertEquals(req.method, "POST");
    assertEquals(new URL(req.url).pathname, "/v1/checkout/sessions");

    // Verify Authorization header encodes secretKey:
    const expectedAuth = `Basic ${encodeBase64(new TextEncoder().encode(`${SECRET_KEY}:`))}`;
    assertEquals(req.headers.get("authorization"), expectedAuth);

    // Verify key form fields are present in the body
    const body = capturedBodies[0];
    const params = new URLSearchParams(body);
    assertEquals(params.get("mode"), "subscription");
    assertEquals(params.get("customer_email"), "user@example.com");
    assertEquals(params.get("success_url"), "https://example.com/success");
    assertEquals(params.get("cancel_url"), "https://example.com/cancel");
    assertEquals(params.get("line_items[0][price]"), "price_test_123");
    assertEquals(params.get("line_items[0][quantity]"), "1");
    assertEquals(params.get("metadata[userId]"), "user-123");
    assertEquals(params.get("metadata[productId]"), "membership");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("createCheckoutSession: uses 'payment' mode for one-time products", async () => {
  const product = makeProduct({ mode: "payment" });
  let capturedBody = "";

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input: string | URL | Request, init?: RequestInit) => {
    capturedBody = init?.body as string ?? "";
    return new Response(
      JSON.stringify({ id: "cs_test_pay", url: "https://checkout.stripe.com/pay/cs_test_pay" }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const provider = createStripePaymentProvider({ secretKey: SECRET_KEY });
    await provider.createCheckoutSession({
      product,
      userId: "user-456",
      userEmail: "user@example.com",
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
    });

    const params = new URLSearchParams(capturedBody);
    assertEquals(params.get("mode"), "payment");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("createCheckoutSession: throws on Stripe API error", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return new Response(
      JSON.stringify({ error: { message: "No such price: price_bad" } }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const provider = createStripePaymentProvider({ secretKey: SECRET_KEY });
    await assertRejects(
      () =>
        provider.createCheckoutSession({
          product: makeProduct({ priceId: "price_bad" }),
          userId: "u1",
          userEmail: "u@example.com",
          successUrl: "https://example.com/success",
          cancelUrl: "https://example.com/cancel",
        }),
      Error,
      "No such price: price_bad",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// parseWebhook — valid signature
// ---------------------------------------------------------------------------

Deno.test("parseWebhook: valid signature returns WebhookEvent", async () => {
  const payload = JSON.stringify({
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_abc",
        customer: "cus_test_123",
        metadata: { userId: "user-abc", productId: "membership" },
      },
    },
  });

  const req = await makeWebhookRequest(payload, WEBHOOK_SECRET);
  const provider = createStripePaymentProvider({ secretKey: SECRET_KEY });
  const event = await provider.parseWebhook(req, WEBHOOK_SECRET);

  assertEquals(event?.type, "checkout.session.completed");
  assertEquals(event?.userId, "user-abc");
  assertEquals(event?.productId, "membership");
  assertEquals(event?.customerId, "cus_test_123");
});

Deno.test("parseWebhook: resolves fields only for checkout.session.completed", async () => {
  const payload = JSON.stringify({
    type: "customer.subscription.updated",
    data: { object: {} },
  });

  const req = await makeWebhookRequest(payload, WEBHOOK_SECRET);
  const provider = createStripePaymentProvider({ secretKey: SECRET_KEY });
  const event = await provider.parseWebhook(req, WEBHOOK_SECRET);

  assertEquals(event?.type, "customer.subscription.updated");
  assertEquals(event?.userId, undefined);
  assertEquals(event?.productId, undefined);
  assertEquals(event?.customerId, undefined);
});

// ---------------------------------------------------------------------------
// parseWebhook — invalid / missing signature
// ---------------------------------------------------------------------------

Deno.test("parseWebhook: wrong signature returns null", async () => {
  const payload = JSON.stringify({ type: "checkout.session.completed", data: { object: {} } });
  const req = await makeWebhookRequest(payload, WEBHOOK_SECRET, { wrongSig: true });

  const provider = createStripePaymentProvider({ secretKey: SECRET_KEY });
  const event = await provider.parseWebhook(req, WEBHOOK_SECRET);

  assertEquals(event, null);
});

Deno.test("parseWebhook: missing Stripe-Signature header returns null", async () => {
  const payload = JSON.stringify({ type: "checkout.session.completed", data: { object: {} } });
  const req = await makeWebhookRequest(payload, WEBHOOK_SECRET, { omitHeader: true });

  const provider = createStripePaymentProvider({ secretKey: SECRET_KEY });
  const event = await provider.parseWebhook(req, WEBHOOK_SECRET);

  assertEquals(event, null);
});

Deno.test("parseWebhook: signature computed with wrong secret returns null", async () => {
  const payload = JSON.stringify({ type: "checkout.session.completed", data: { object: {} } });
  // Request signed with a different secret
  const req = await makeWebhookRequest(payload, "wrong_secret");

  const provider = createStripePaymentProvider({ secretKey: SECRET_KEY });
  const event = await provider.parseWebhook(req, WEBHOOK_SECRET);

  assertEquals(event, null);
});

// ---------------------------------------------------------------------------
// createPortalSession
// ---------------------------------------------------------------------------

Deno.test("createPortalSession: builds correct request", async () => {
  const capturedBodies: string[] = [];
  const capturedUrls: string[] = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    capturedUrls.push(url);
    const body = (init?.body as string) ?? (input instanceof Request ? await (input as Request).text() : "");
    capturedBodies.push(body);

    return new Response(
      JSON.stringify({ url: "https://billing.stripe.com/session/bps_test_abc" }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const provider = createStripePaymentProvider({ secretKey: SECRET_KEY });
    const result = await provider.createPortalSession({
      customerId: "cus_test_123",
      returnUrl: "https://example.com/account",
    });

    assertEquals(result.url, "https://billing.stripe.com/session/bps_test_abc");
    assertEquals(capturedUrls[0], "https://api.stripe.com/v1/billing_portal/sessions");

    const params = new URLSearchParams(capturedBodies[0]);
    assertEquals(params.get("customer"), "cus_test_123");
    assertEquals(params.get("return_url"), "https://example.com/account");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
