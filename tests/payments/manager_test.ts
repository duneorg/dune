/**
 * Unit tests for PaymentManager.
 *
 * Uses mock implementations of PaymentProvider and SiteUserStore.
 * No HTTP calls are made — all external behaviour is stubbed at the interface level.
 */

import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { createPaymentManager } from "../../src/payments/manager.ts";
import type { PaymentProvider, CheckoutSession, WebhookEvent, Product } from "../../src/payments/types.ts";
import type { SiteUserStore } from "../../src/auth/user-store.ts";
import type { SiteUser, SiteUserCreate } from "../../src/auth/types.ts";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function makeUser(overrides: Partial<SiteUser> = {}): SiteUser {
  return {
    id: "user-123",
    email: "user@example.com",
    name: "Test User",
    provider: "magic",
    roles: [],
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
    enabled: true,
    ...overrides,
  };
}

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

/** Minimal mock SiteUserStore. Only getById and update are exercised by the manager. */
class MockUserStore implements SiteUserStore {
  users: Map<string, SiteUser> = new Map();
  updateCalls: Array<{ id: string; updates: Partial<SiteUser> }> = [];

  async getById(id: string): Promise<SiteUser | null> {
    return this.users.get(id) ?? null;
  }

  async getByEmail(_email: string): Promise<SiteUser | null> { return null; }
  async getByProvider(_provider: string, _providerId: string): Promise<SiteUser | null> { return null; }
  async create(_user: SiteUserCreate): Promise<SiteUser> { throw new Error("not implemented"); }

  async update(
    id: string,
    updates: Partial<Pick<SiteUser, "name" | "avatarUrl" | "roles" | "lastSeenAt" | "enabled">>,
  ): Promise<SiteUser | null> {
    this.updateCalls.push({ id, updates });
    const user = this.users.get(id);
    if (!user) return null;
    const updated = { ...user, ...updates };
    this.users.set(id, updated);
    return updated;
  }

  async list(_opts?: { limit?: number; offset?: number }): Promise<SiteUser[]> { return []; }
  async delete(_id: string): Promise<boolean> { return false; }
}

/** Configurable mock PaymentProvider. */
class MockPaymentProvider implements PaymentProvider {
  parseWebhookResult: WebhookEvent | null = null;
  checkoutSessionResult: CheckoutSession = {
    url: "https://checkout.stripe.com/pay/cs_mock",
    sessionId: "cs_mock",
  };
  portalUrl = "https://billing.stripe.com/session/bps_mock";

  async createCheckoutSession(opts: {
    product: Product;
    userId: string;
    userEmail: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<CheckoutSession> {
    return this.checkoutSessionResult;
  }

  async parseWebhook(_req: Request, _secret: string): Promise<WebhookEvent | null> {
    return this.parseWebhookResult;
  }

  async createPortalSession(_opts: { customerId: string; returnUrl: string }): Promise<{ url: string }> {
    return { url: this.portalUrl };
  }
}

function buildManager(opts: {
  products?: Product[];
  parseWebhookResult?: WebhookEvent | null;
  users?: SiteUser[];
}) {
  const provider = new MockPaymentProvider();
  if (opts.parseWebhookResult !== undefined) {
    provider.parseWebhookResult = opts.parseWebhookResult;
  }

  const userStore = new MockUserStore();
  for (const u of opts.users ?? []) {
    userStore.users.set(u.id, u);
  }

  const manager = createPaymentManager({
    provider,
    products: opts.products ?? [makeProduct()],
    webhookSecret: "whsec_test",
    userStore,
    baseUrl: "https://example.com",
  });

  return { manager, provider, userStore };
}

// ---------------------------------------------------------------------------
// checkout()
// ---------------------------------------------------------------------------

Deno.test("checkout: returns CheckoutSession for valid product", async () => {
  const { manager } = buildManager({});
  const user = makeUser();
  const session = await manager.checkout("membership", user);
  assertEquals(session.sessionId, "cs_mock");
  assertEquals(session.url, "https://checkout.stripe.com/pay/cs_mock");
});

Deno.test("checkout: throws for unknown productId", async () => {
  const { manager } = buildManager({});
  const user = makeUser();
  await assertRejects(
    () => manager.checkout("nonexistent", user),
    Error,
    "Unknown payment product",
  );
});

// ---------------------------------------------------------------------------
// handleWebhook() — invalid signature
// ---------------------------------------------------------------------------

Deno.test("handleWebhook: invalid signature returns 400", async () => {
  const { manager } = buildManager({ parseWebhookResult: null });
  const req = new Request("http://example.com/payments/webhook", { method: "POST", body: "{}" });
  const res = await manager.handleWebhook(req);
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "Invalid webhook signature");
});

// ---------------------------------------------------------------------------
// handleWebhook() — unknown event type
// ---------------------------------------------------------------------------

Deno.test("handleWebhook: unknown event type returns 200 (idempotent)", async () => {
  const unknownEvent: WebhookEvent = {
    type: "customer.subscription.updated",
    raw: {},
  };
  const { manager } = buildManager({ parseWebhookResult: unknownEvent });
  const req = new Request("http://example.com/payments/webhook", { method: "POST", body: "{}" });
  const res = await manager.handleWebhook(req);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.received, true);
});

// ---------------------------------------------------------------------------
// handleWebhook() — checkout.session.completed assigns role
// ---------------------------------------------------------------------------

Deno.test("handleWebhook: checkout.session.completed assigns role to user", async () => {
  const user = makeUser({ id: "user-abc", roles: [] });
  const event: WebhookEvent = {
    type: "checkout.session.completed",
    userId: "user-abc",
    productId: "membership",
    customerId: "cus_test",
    raw: {},
  };

  const { manager, userStore } = buildManager({
    parseWebhookResult: event,
    users: [user],
  });

  const req = new Request("http://example.com/payments/webhook", { method: "POST", body: "{}" });
  const res = await manager.handleWebhook(req);
  assertEquals(res.status, 200);

  // Verify the role was added via userStore.update
  assertEquals(userStore.updateCalls.length, 1);
  assertEquals(userStore.updateCalls[0].id, "user-abc");
  const updatedUser = await userStore.getById("user-abc");
  assertEquals(updatedUser?.roles.includes("member"), true);
});

Deno.test("handleWebhook: does not duplicate role if already present", async () => {
  const user = makeUser({ id: "user-abc", roles: ["member"] });
  const event: WebhookEvent = {
    type: "checkout.session.completed",
    userId: "user-abc",
    productId: "membership",
    customerId: "cus_test",
    raw: {},
  };

  const { manager, userStore } = buildManager({
    parseWebhookResult: event,
    users: [user],
  });

  const req = new Request("http://example.com/payments/webhook", { method: "POST", body: "{}" });
  const res = await manager.handleWebhook(req);
  assertEquals(res.status, 200);

  // No update should be issued since role is already present
  assertEquals(userStore.updateCalls.length, 0);
});

Deno.test("handleWebhook: checkout.session.completed with missing userId — no update", async () => {
  const event: WebhookEvent = {
    type: "checkout.session.completed",
    // userId intentionally absent
    productId: "membership",
    raw: {},
  };

  const { manager, userStore } = buildManager({ parseWebhookResult: event });
  const req = new Request("http://example.com/payments/webhook", { method: "POST", body: "{}" });
  const res = await manager.handleWebhook(req);
  assertEquals(res.status, 200);
  assertEquals(userStore.updateCalls.length, 0);
});

Deno.test("handleWebhook: checkout.session.completed with product without role — no update", async () => {
  const productNoRole = makeProduct({ role: undefined });
  const user = makeUser({ id: "user-xyz", roles: [] });
  const event: WebhookEvent = {
    type: "checkout.session.completed",
    userId: "user-xyz",
    productId: "membership",
    raw: {},
  };

  const { manager, userStore } = buildManager({
    products: [productNoRole],
    parseWebhookResult: event,
    users: [user],
  });

  const req = new Request("http://example.com/payments/webhook", { method: "POST", body: "{}" });
  const res = await manager.handleWebhook(req);
  assertEquals(res.status, 200);
  assertEquals(userStore.updateCalls.length, 0);
});

// ---------------------------------------------------------------------------
// portal()
// ---------------------------------------------------------------------------

Deno.test("portal: returns billing portal URL", async () => {
  const { manager } = buildManager({});
  const user = makeUser();
  const result = await manager.portal(user, "cus_test_123");
  assertEquals(result.url, "https://billing.stripe.com/session/bps_mock");
});
