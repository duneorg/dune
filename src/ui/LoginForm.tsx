/** @jsxImportSource preact */
/**
 * LoginForm — server-rendered component (no island needed).
 *
 * Renders a login form that POSTs to /auth/login. Shows OAuth provider buttons
 * for configured providers (github, google, discord) and optionally a magic
 * link email input when "magic" is in providers.
 */

import { h } from "preact";
import type { JSX } from "preact";

/** Props for the {@link LoginForm} server-rendered component. */
export interface LoginFormProps {
  /** OAuth providers to show as buttons. Supported: "github" | "google" | "discord" | "magic" */
  providers?: string[];
  /** Redirect target after login (pre-filled from URL query param). */
  redirectTo?: string;
  className?: string;
}

const PROVIDER_LABELS: Record<string, string> = {
  github: "Continue with GitHub",
  google: "Continue with Google",
  discord: "Continue with Discord",
};

const PROVIDER_HREFS: Record<string, string> = {
  github: "/auth/github",
  google: "/auth/google",
  discord: "/auth/discord",
};

export default function LoginForm({
  providers = [],
  redirectTo,
  className,
}: LoginFormProps): JSX.Element {
  const oauthProviders = providers.filter((p) => p !== "magic");
  const hasMagic = providers.includes("magic");
  const redirectParam = redirectTo ? `?next=${encodeURIComponent(redirectTo)}` : "";

  return (
    <div class={`dune-login-form${className ? ` ${className}` : ""}`}>
      {/* OAuth provider buttons */}
      {oauthProviders.length > 0 && (
        <div class="dune-login-form__providers">
          {oauthProviders.map((provider) => {
            const href = PROVIDER_HREFS[provider]
              ? `${PROVIDER_HREFS[provider]}${redirectParam}`
              : `/auth/${provider}${redirectParam}`;
            const label = PROVIDER_LABELS[provider] ?? `Continue with ${capitalize(provider)}`;
            return (
              <a
                key={provider}
                href={href}
                class={`dune-login-form__provider dune-login-form__provider--${provider}`}
                rel="noopener"
              >
                {label}
              </a>
            );
          })}
        </div>
      )}

      {/* Separator when both OAuth and magic link are shown */}
      {oauthProviders.length > 0 && hasMagic && (
        <div class="dune-login-form__separator" aria-hidden="true">
          <span>or</span>
        </div>
      )}

      {/* Magic link email form */}
      {hasMagic && (
        <form
          class="dune-login-form__magic"
          method="POST"
          action={`/auth/magic${redirectParam}`}
        >
          {redirectTo && (
            <input type="hidden" name="next" value={redirectTo} />
          )}
          <label class="dune-login-form__label" for="dune-magic-email">
            Email address
          </label>
          <input
            id="dune-magic-email"
            class="dune-login-form__input"
            type="email"
            name="email"
            required
            placeholder="you@example.com"
            autocomplete="email"
          />
          <button type="submit" class="dune-login-form__submit">
            Send magic link
          </button>
        </form>
      )}
    </div>
  );
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}
