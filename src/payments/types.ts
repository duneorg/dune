/**
 * Payment primitive types for Dune CMS.
 *
 * Defines the PaymentProvider plugin interface and supporting value types.
 * Concrete providers (e.g. StripePaymentProvider) implement PaymentProvider.
 */

/** @module */

/** A product defined in site.yaml payments.products. */
export interface Product {
  /** Site-defined product identifier, e.g. "membership" */
  id: string;
  /** Human-readable product name */
  name: string;
  /** Provider-side price ID, e.g. Stripe price_xxx */
  priceId: string;
  /**
   * Role to assign to the user upon successful payment.
   * Looked up in SiteUserStore.update() by the PaymentManager.
   */
  role?: string;
  /**
   * Checkout mode: "subscription" (recurring) or "payment" (one-time).
   * Defaults to "subscription".
   */
  mode?: "subscription" | "payment";
}

/** Returned by PaymentProvider.createCheckoutSession(). */
export interface CheckoutSession {
  /** Provider-generated redirect URL for the end user. */
  url: string;
  /** Provider session identifier (e.g. Stripe cs_xxx). */
  sessionId: string;
}

/**
 * A normalised webhook event parsed by the provider from an inbound HTTP
 * request. Populated with whatever fields the provider can resolve.
 */
export interface WebhookEvent {
  /** Provider event type string, e.g. "checkout.session.completed" */
  type: string;
  /** Dune user ID resolved from provider metadata, if present */
  userId?: string;
  /** Dune product ID resolved from provider metadata, if present */
  productId?: string;
  /** Provider customer ID, e.g. Stripe cus_xxx */
  customerId?: string;
  /** Raw provider payload — provider-specific, not type-safe */
  raw: unknown;
}

/**
 * Plugin interface for payment providers.
 *
 * Implement this interface to integrate any payment processor with Dune CMS.
 * The concrete StripePaymentProvider is shipped in src/payments/stripe.ts.
 */
export interface PaymentProvider {
  /**
   * Create a hosted checkout session for the given product and user.
   *
   * @returns CheckoutSession with the redirect URL and provider session ID.
   */
  createCheckoutSession(opts: {
    product: Product;
    userId: string;
    userEmail: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<CheckoutSession>;

  /**
   * Verify and parse an inbound webhook request.
   *
   * Implementations must verify the provider's signature before returning
   * a WebhookEvent. Returns null when the signature is invalid or missing.
   *
   * @param req - Raw inbound HTTP request (body will be read once).
   * @param secret - Webhook signing secret from config.
   */
  parseWebhook(req: Request, secret: string): Promise<WebhookEvent | null>;

  /**
   * Create a billing portal session for subscription management.
   *
   * @returns An object containing the portal redirect URL.
   */
  createPortalSession(opts: {
    customerId: string;
    returnUrl: string;
  }): Promise<{ url: string }>;
}
