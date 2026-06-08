/** @jsxImportSource preact */
/**
 * SubscriptionForm — client-side island.
 *
 * POSTs to /payments/checkout/{productId} on submit. Shows a button with the
 * product name and a loading state. On success the server redirects to the
 * payment provider — the button just initiates the checkout session.
 */

import { h } from "preact";
import type { JSX } from "preact";
import { useState } from "preact/hooks";

/** Props for the {@link SubscriptionForm} island component. */
export interface SubscriptionFormProps {
  productId: string;
  label?: string;
  className?: string;
}

export default function SubscriptionForm({
  productId,
  label = "Subscribe",
  className,
}: SubscriptionFormProps): JSX.Element {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: Event) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/payments/checkout/${encodeURIComponent(productId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId }),
      });

      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError((d as { error?: string }).error ?? "Checkout failed. Please try again.");
        return;
      }

      // Expect a redirect URL from the payments handler
      const data = await res.json().catch(() => null);
      if (data && typeof (data as { url?: string }).url === "string") {
        globalThis.location.href = (data as { url: string }).url;
        return;
      }

      // If the server redirects via 302, fetch will have followed it —
      // check the final URL and navigate there.
      if (res.redirected) {
        globalThis.location.href = res.url;
      }
    } catch {
      setError("Unable to start checkout. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      class={`dune-subscription-form${className ? ` ${className}` : ""}`}
      onSubmit={handleSubmit}
      noValidate
    >
      {error && (
        <p class="dune-subscription-form__error" role="alert">
          {error}
        </p>
      )}
      <button
        type="submit"
        class="dune-subscription-form__btn"
        disabled={loading}
        aria-busy={loading}
      >
        {loading ? "Loading…" : label}
      </button>
    </form>
  );
}
