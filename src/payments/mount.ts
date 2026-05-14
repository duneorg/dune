/**
 * Payment route mounting.
 *
 * Reads the `payments:` block from site.yaml, builds the configured provider,
 * wires up a PaymentManager, and registers three routes on a Fresh app:
 *
 *   POST /payments/checkout/:productId — initiate checkout (auth required)
 *   POST /payments/webhook             — receive provider webhook (provider-signed)
 *   GET  /payments/portal              — billing portal redirect (auth required)
 *
 * This is a safe no-op when `payments:` is absent from the config or the
 * `provider:` field is not set.
 */

/** @module */

// deno-lint-ignore no-explicit-any
import type { App } from "fresh";
import type { SiteConfig } from "../config/types.ts";
import type { SiteUserStore } from "../auth/user-store.ts";
import { createStripePaymentProvider } from "./stripe.ts";
import { createPaymentManager } from "./manager.ts";
import { createPaymentRoutes } from "./routes.ts";
import type { Product } from "./types.ts";

// deno-lint-ignore no-explicit-any
type FreshApp = App<any>;

export interface PaymentMountConfig {
  /** Full site config — reads the `payments:` block. */
  siteConfig: SiteConfig;
  /** User store used by the manager to assign roles after payment. */
  userStore: SiteUserStore;
  /** Base URL of the site (e.g. "https://example.com") for redirect URLs. */
  baseUrl: string;
}

/**
 * Mount payment routes onto a Fresh app.
 *
 * No-ops silently when `siteConfig.payments` is missing or has no `provider`.
 * This allows sites that don't use payments to load without any extra config.
 */
export function mountPaymentRoutes(app: FreshApp, config: PaymentMountConfig): void {
  const { siteConfig, userStore, baseUrl } = config;
  const paymentsConfig = siteConfig.payments;

  // No-op when payments is not configured or provider is absent
  if (!paymentsConfig?.provider) return;

  const secretKey = expandEnv(paymentsConfig.secret_key ?? "");
  const webhookSecret = expandEnv(paymentsConfig.webhook_secret ?? "");

  if (!secretKey) {
    console.warn("[payments] payments.secret_key is not set — payment routes disabled");
    return;
  }

  if (!webhookSecret) {
    console.warn("[payments] payments.webhook_secret is not set — payment routes disabled");
    return;
  }

  // Build the provider (only "stripe" supported for now)
  const provider = createStripePaymentProvider({ secretKey });

  // Map YAML product declarations to the Product interface
  const products: Product[] = (paymentsConfig.products ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    priceId: p.price_id,
    role: p.role,
    mode: p.mode ?? "subscription",
  }));

  const manager = createPaymentManager({
    provider,
    products,
    webhookSecret,
    userStore,
    baseUrl,
  });

  const handlers = createPaymentRoutes(manager);

  // POST /payments/checkout/:productId
  app.post("/payments/checkout/:productId", (fc) => {
    const productId = fc.params?.["productId"] ?? "";
    return handlers.checkout(fc.req, { productId });
  });

  // POST /payments/webhook
  app.post("/payments/webhook", (fc) => handlers.webhook(fc.req));

  // GET /payments/portal
  app.get("/payments/portal", (fc) => handlers.portal(fc.req));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Expand "$ENV_VAR" strings to their environment variable value. */
function expandEnv(value: string): string {
  if (typeof value === "string" && value.startsWith("$")) {
    return Deno.env.get(value.slice(1)) ?? "";
  }
  return value;
}
