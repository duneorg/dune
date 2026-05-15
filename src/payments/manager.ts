/**
 * Payment manager — orchestrates checkout, webhook handling, and portal sessions.
 *
 * Sits between the route layer and the PaymentProvider. Responsible for:
 *   1. Looking up product definitions by ID.
 *   2. Constructing success/cancel/return URLs from the configured base URL.
 *   3. Calling provider methods with the right arguments.
 *   4. Assigning roles to users after a successful payment event.
 */

/** @module */

import type { CheckoutSession, PaymentProvider, Product, WebhookEvent } from "./types.ts";
import type { SiteUserStore } from "../auth/user-store.ts";
import type { SiteUser } from "../auth/types.ts";
import type { DuneAuthSystem } from "../auth/authz.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PaymentManagerConfig {
  /** Concrete payment provider implementation (e.g. StripePaymentProvider). */
  provider: PaymentProvider;
  /** All products declared in site.yaml payments.products. */
  products: Product[];
  /** Webhook signing secret forwarded to provider.parseWebhook(). */
  webhookSecret: string;
  /** User store used to assign roles after a successful payment. */
  userStore: SiteUserStore;
  /** Base URL of the site, e.g. "https://example.com". Used to build redirect URLs. */
  baseUrl: string;
  /**
   * Optional authz system. When provided, `authz.addMember()` is called alongside
   * `userStore.update()` so that role grants are reflected in the authz tuple store
   * immediately — not deferred until the next restart + bootstrap.
   */
  authz?: DuneAuthSystem;
}

export interface PaymentManager {
  /**
   * Initiate checkout for the given product and user.
   *
   * @param productId - Site-defined product ID from site.yaml.
   * @param user - The authenticated site user initiating the purchase.
   * @throws Error when productId is not found in the configured product list.
   */
  checkout(productId: string, user: SiteUser): Promise<CheckoutSession>;

  /**
   * Handle an inbound provider webhook request.
   *
   * Verifies the signature, processes the event, and returns an HTTP Response
   * suitable for returning directly to the provider.
   *
   * @returns HTTP 400 on invalid signature, HTTP 200 on success (including
   *          unrecognised event types, which are silently ignored).
   */
  handleWebhook(req: Request): Promise<Response>;

  /**
   * Create a billing portal session for subscription management.
   *
   * @param user - The authenticated site user.
   * @param customerId - Provider-side customer ID (e.g. Stripe cus_xxx).
   */
  portal(user: SiteUser, customerId: string): Promise<{ url: string }>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a PaymentManager from the given configuration.
 *
 * @example
 * ```ts
 * const manager = createPaymentManager({
 *   provider: stripeProvider,
 *   products,
 *   webhookSecret: "whsec_...",
 *   userStore,
 *   baseUrl: "https://example.com",
 * });
 * ```
 */
export function createPaymentManager(config: PaymentManagerConfig): PaymentManager {
  const { provider, products, webhookSecret, userStore, baseUrl, authz } = config;

  /** Look up a product by its site-defined ID. */
  function findProduct(productId: string): Product | undefined {
    return products.find((p) => p.id === productId);
  }

  async function checkout(productId: string, user: SiteUser): Promise<CheckoutSession> {
    const product = findProduct(productId);
    if (!product) {
      throw new Error(`Unknown payment product: "${productId}"`);
    }

    // Build success/cancel URLs anchored to the site base URL
    const successUrl = `${baseUrl}/payments/success?product=${encodeURIComponent(productId)}`;
    const cancelUrl = `${baseUrl}/payments/cancel?product=${encodeURIComponent(productId)}`;

    return provider.createCheckoutSession({
      product,
      userId: user.id,
      userEmail: user.email,
      successUrl,
      cancelUrl,
    });
  }

  async function handleWebhook(req: Request): Promise<Response> {
    let event: WebhookEvent | null;
    try {
      event = await provider.parseWebhook(req, webhookSecret);
    } catch {
      return Response.json({ error: "Webhook processing error" }, { status: 400 });
    }

    if (event === null) {
      return Response.json({ error: "Invalid webhook signature" }, { status: 400 });
    }

    // Process known event types; silently ignore unknown ones (idempotent)
    if (event.type === "checkout.session.completed") {
      await handleCheckoutCompleted(event);
    }

    return Response.json({ received: true }, { status: 200 });
  }

  async function handleCheckoutCompleted(event: WebhookEvent): Promise<void> {
    const { userId, productId, customerId } = event;

    // Nothing to do if metadata fields are missing
    if (!userId || !productId) return;

    // Look up the user — tolerate deletion / concurrent updates
    const user = await userStore.getById(userId);
    if (!user) return;

    const updates: Parameters<typeof userStore.update>[1] = {};

    // Store the Stripe customer ID so the billing portal handler can look it
    // up securely without accepting it from client-controlled input.
    if (customerId && user.stripeCustomerId !== customerId) {
      updates.stripeCustomerId = customerId;
    }

    // Assign the product role if configured and not already present.
    const product = findProduct(productId);
    const roleToGrant = product?.role;
    if (roleToGrant && !user.roles.includes(roleToGrant)) {
      updates.roles = [...user.roles, roleToGrant];
    }

    if (Object.keys(updates).length > 0) {
      await userStore.update(userId, updates);
    }

    // Sync the new role into the authz tuple store so the grant takes effect
    // immediately without waiting for a restart + bootstrap.
    if (roleToGrant && updates.roles && authz) {
      await authz.addMember({
        member: { type: "user", id: userId },
        group: { type: "group", id: roleToGrant },
      }).catch((err) => {
        console.warn(`[dune/payments] authz.addMember failed for user ${userId}, role ${roleToGrant}:`, err);
      });
    }
  }

  async function portal(user: SiteUser, customerId: string): Promise<{ url: string }> {
    const returnUrl = `${baseUrl}/account`;
    return provider.createPortalSession({ customerId, returnUrl });
  }

  return { checkout, handleWebhook, portal };
}
