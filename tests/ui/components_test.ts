/**
 * Tests for @dune/core/ui components.
 *
 * SSR-based snapshot tests using preact-render-to-string — no real browser.
 * Tests cover:
 *   - LoginForm: provider anchor tags and magic link input rendering
 *   - ProfileCard: user name, email, and logout form rendering
 *   - SubscriptionForm: button with correct product label
 *   - SearchBar debounce utility
 */

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { h } from "preact";
import { render } from "preact-render-to-string";

import LoginForm from "../../src/ui/LoginForm.tsx";
import ProfileCard from "../../src/ui/ProfileCard.tsx";
import SubscriptionForm from "../../src/ui/SubscriptionForm.tsx";
import { debounce } from "../../src/ui/SearchBar.tsx";

// ── LoginForm ─────────────────────────────────────────────────────────────────

Deno.test("LoginForm: renders anchor for github provider", () => {
  const html = render(h(LoginForm, { providers: ["github"] }));
  assertStringIncludes(html, 'href="/auth/github"');
  assertStringIncludes(html, "Continue with GitHub");
});

Deno.test("LoginForm: renders anchor for google provider", () => {
  const html = render(h(LoginForm, { providers: ["google"] }));
  assertStringIncludes(html, 'href="/auth/google"');
  assertStringIncludes(html, "Continue with Google");
});

Deno.test("LoginForm: renders anchor for discord provider", () => {
  const html = render(h(LoginForm, { providers: ["discord"] }));
  assertStringIncludes(html, 'href="/auth/discord"');
  assertStringIncludes(html, "Continue with Discord");
});

Deno.test("LoginForm: renders multiple provider anchors", () => {
  const html = render(h(LoginForm, { providers: ["github", "google", "discord"] }));
  assertStringIncludes(html, 'href="/auth/github"');
  assertStringIncludes(html, 'href="/auth/google"');
  assertStringIncludes(html, 'href="/auth/discord"');
});

Deno.test("LoginForm: renders magic link email input when magic in providers", () => {
  const html = render(h(LoginForm, { providers: ["magic"] }));
  assertStringIncludes(html, 'type="email"');
  assertStringIncludes(html, 'name="email"');
  assertStringIncludes(html, 'action="/auth/magic"');
});

Deno.test("LoginForm: magic input not rendered when magic not in providers", () => {
  const html = render(h(LoginForm, { providers: ["github"] }));
  // Should not contain an email input
  assertEquals(html.includes('type="email"'), false);
  assertEquals(html.includes('action="/auth/magic"'), false);
});

Deno.test("LoginForm: renders magic link alongside oauth providers", () => {
  const html = render(h(LoginForm, { providers: ["github", "magic"] }));
  assertStringIncludes(html, 'href="/auth/github"');
  assertStringIncludes(html, 'type="email"');
});

Deno.test("LoginForm: appends redirectTo param to oauth provider href", () => {
  const html = render(h(LoginForm, { providers: ["github"], redirectTo: "/dashboard" }));
  assertStringIncludes(html, "/auth/github?next=%2Fdashboard");
});

Deno.test("LoginForm: appends redirectTo param to magic link action", () => {
  const html = render(h(LoginForm, { providers: ["magic"], redirectTo: "/profile" }));
  assertStringIncludes(html, "/auth/magic?next=%2Fprofile");
});

Deno.test("LoginForm: renders with no providers", () => {
  const html = render(h(LoginForm, { providers: [] }));
  // Neither oauth links nor magic form should appear
  assertEquals(html.includes("/auth/github"), false);
  assertEquals(html.includes('type="email"'), false);
});

Deno.test("LoginForm: applies custom className", () => {
  const html = render(h(LoginForm, { providers: ["github"], className: "my-custom" }));
  assertStringIncludes(html, "dune-login-form my-custom");
});

// ── ProfileCard ───────────────────────────────────────────────────────────────

Deno.test("ProfileCard: renders user name", () => {
  const html = render(h(ProfileCard, {
    user: { name: "Alice Smith", email: "alice@example.com", roles: ["member"] },
  }));
  assertStringIncludes(html, "Alice Smith");
});

Deno.test("ProfileCard: renders user email", () => {
  const html = render(h(ProfileCard, {
    user: { name: "Alice Smith", email: "alice@example.com", roles: [] },
  }));
  assertStringIncludes(html, "alice@example.com");
});

Deno.test("ProfileCard: falls back to email when name is absent", () => {
  const html = render(h(ProfileCard, {
    user: { email: "bob@example.com", roles: ["admin"] },
  }));
  assertStringIncludes(html, "bob@example.com");
});

Deno.test("ProfileCard: renders logout form posting to /auth/logout", () => {
  const html = render(h(ProfileCard, {
    user: { name: "Alice", email: "alice@example.com", roles: [] },
  }));
  assertStringIncludes(html, 'action="/auth/logout"');
  assertStringIncludes(html, 'method="POST"');
});

Deno.test("ProfileCard: renders logout button", () => {
  const html = render(h(ProfileCard, {
    user: { name: "Alice", email: "alice@example.com", roles: [] },
  }));
  assertStringIncludes(html, "Sign out");
});

Deno.test("ProfileCard: renders avatar img when avatarUrl provided", () => {
  const html = render(h(ProfileCard, {
    user: {
      name: "Alice",
      email: "alice@example.com",
      avatarUrl: "https://example.com/avatar.png",
      roles: [],
    },
  }));
  assertStringIncludes(html, 'src="https://example.com/avatar.png"');
  assertStringIncludes(html, "<img");
});

Deno.test("ProfileCard: renders avatar placeholder when no avatarUrl", () => {
  const html = render(h(ProfileCard, {
    user: { name: "Alice", email: "alice@example.com", roles: [] },
  }));
  assertStringIncludes(html, "dune-profile-card__avatar-placeholder");
  // Placeholder shows first letter of display name
  assertStringIncludes(html, "A");
});

Deno.test("ProfileCard: renders role badges", () => {
  const html = render(h(ProfileCard, {
    user: { name: "Alice", email: "alice@example.com", roles: ["admin", "editor"] },
  }));
  assertStringIncludes(html, "admin");
  assertStringIncludes(html, "editor");
});

Deno.test("ProfileCard: applies custom className", () => {
  const html = render(h(ProfileCard, {
    user: { email: "alice@example.com", roles: [] },
    className: "compact",
  }));
  assertStringIncludes(html, "dune-profile-card compact");
});

// ── SubscriptionForm ──────────────────────────────────────────────────────────

Deno.test("SubscriptionForm: renders button with default label", () => {
  const html = render(h(SubscriptionForm, { productId: "plan-pro" }));
  assertStringIncludes(html, "Subscribe");
  assertStringIncludes(html, 'type="submit"');
});

Deno.test("SubscriptionForm: renders button with custom label", () => {
  const html = render(h(SubscriptionForm, { productId: "plan-pro", label: "Get Pro" }));
  assertStringIncludes(html, "Get Pro");
});

Deno.test("SubscriptionForm: renders a form element", () => {
  const html = render(h(SubscriptionForm, { productId: "plan-basic" }));
  assertStringIncludes(html, "<form");
  assertStringIncludes(html, "dune-subscription-form");
});

Deno.test("SubscriptionForm: applies custom className", () => {
  const html = render(h(SubscriptionForm, { productId: "plan-pro", className: "hero-cta" }));
  assertStringIncludes(html, "dune-subscription-form hero-cta");
});

// ── SearchBar debounce utility ────────────────────────────────────────────────

Deno.test("debounce: defers callback execution", async () => {
  const calls: number[] = [];
  const fn = debounce((n: unknown) => calls.push(n as number), 50);

  fn(1);
  fn(2);
  fn(3);

  // None called yet
  assertEquals(calls.length, 0);

  // Wait for debounce
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Only the last call should have fired
  assertEquals(calls.length, 1);
  assertEquals(calls[0], 3);
});

Deno.test("debounce: fires immediately if enough time passes between calls", async () => {
  const calls: number[] = [];
  const fn = debounce((n: unknown) => calls.push(n as number), 30);

  fn(1);
  await new Promise((resolve) => setTimeout(resolve, 60));
  fn(2);
  await new Promise((resolve) => setTimeout(resolve, 60));

  assertEquals(calls.length, 2);
  assertEquals(calls[0], 1);
  assertEquals(calls[1], 2);
});
