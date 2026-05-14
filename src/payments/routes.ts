/**
 * Payment route handlers.
 *
 * Exposes three endpoints:
 *   POST /payments/checkout/:productId — initiate a checkout session (auth required)
 *   POST /payments/webhook             — receive provider webhook (no auth — provider signs)
 *   GET  /payments/portal              — open billing portal session (auth required)
 *
 * Route handlers receive plain Request objects. The authenticated site user is
 * read from the x-dune-site-user header injected by the Dune auth middleware,
 * mirroring the pattern used in src/auth/api-guard.ts.
 */

/** @module */

import { getSiteUser } from "../auth/types.ts";
import type { PaymentManager } from "./manager.ts";

// ---------------------------------------------------------------------------
// Handler types
// ---------------------------------------------------------------------------

/**
 * A minimal route-handler signature compatible with how Fresh handlers
 * receive requests in Dune's generated/mounted routes.
 */
export type RouteHandler = (req: Request, params?: Record<string, string>) => Promise<Response>;

export interface PaymentRouteHandlers {
  /** POST /payments/checkout/:productId */
  checkout: RouteHandler;
  /** POST /payments/webhook */
  webhook: RouteHandler;
  /** GET /payments/portal */
  portal: RouteHandler;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the three payment route handlers from a configured PaymentManager.
 *
 * Mount these handlers via mountPaymentRoutes() or directly on a Fresh app.
 */
export function createPaymentRoutes(manager: PaymentManager): PaymentRouteHandlers {
  /**
   * POST /payments/checkout/:productId
   *
   * Requires an authenticated site user. Initiates a Stripe checkout session
   * and redirects the browser to the hosted checkout URL.
   */
  async function checkout(
    req: Request,
    params?: Record<string, string>,
  ): Promise<Response> {
    const user = getSiteUser(req);
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const productId = params?.["productId"] ?? params?.["product_id"];
    if (!productId) {
      return Response.json({ error: "Missing productId" }, { status: 400 });
    }

    let session;
    try {
      session = await manager.checkout(productId, user);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Checkout failed";
      return Response.json({ error: message }, { status: 400 });
    }

    // Redirect the browser to the Stripe-hosted checkout page
    return new Response(null, {
      status: 303,
      headers: { Location: session.url },
    });
  }

  /**
   * POST /payments/webhook
   *
   * No Dune auth — the provider signs the request body.
   * Delegates signature verification entirely to the PaymentManager.
   */
  async function webhook(req: Request): Promise<Response> {
    return manager.handleWebhook(req);
  }

  /**
   * GET /payments/portal
   *
   * Requires an authenticated site user. Redirects to the Stripe billing
   * portal so the user can manage their subscription.
   *
   * The Stripe customer ID is read exclusively from the user's stored profile
   * (set by the webhook handler after a successful checkout). It is never
   * accepted from query parameters to prevent IDOR attacks.
   */
  async function portal(req: Request): Promise<Response> {
    const user = getSiteUser(req);
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Use only the verified customer ID stored on the user profile.
    // Accepting customerId from client input (query param, body, etc.) would
    // allow any authenticated user to open a billing portal for any customer.
    const customerId = user.stripeCustomerId;
    if (!customerId) {
      return Response.json(
        { error: "No billing account found. Please complete a purchase first." },
        { status: 404 },
      );
    }

    let result;
    try {
      result = await manager.portal(user, customerId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Portal session failed";
      return Response.json({ error: message }, { status: 400 });
    }

    return new Response(null, {
      status: 303,
      headers: { Location: result.url },
    });
  }

  return { checkout, webhook, portal };
}
