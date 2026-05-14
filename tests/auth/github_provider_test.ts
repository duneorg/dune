/**
 * Tests for GitHub OAuth provider.
 * Only tests authorizationUrl (no HTTP calls). exchangeCode/getUser are not tested
 * end-to-end — too many external dependencies.
 */

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createGitHubProvider } from "../../src/auth/providers/github.ts";

const CONFIG = { clientId: "test-client-id", clientSecret: "test-client-secret" };
const REDIRECT_URI = "https://example.com/auth/github/callback";
const STATE = "random-csrf-state-token";

Deno.test("GitHubProvider: authorizationUrl contains client_id", () => {
  const provider = createGitHubProvider(CONFIG);
  const url = provider.authorizationUrl(STATE, REDIRECT_URI);

  assertStringIncludes(url, "client_id=test-client-id");
});

Deno.test("GitHubProvider: authorizationUrl contains state", () => {
  const provider = createGitHubProvider(CONFIG);
  const url = provider.authorizationUrl(STATE, REDIRECT_URI);

  assertStringIncludes(url, `state=${STATE}`);
});

Deno.test("GitHubProvider: authorizationUrl contains redirect_uri", () => {
  const provider = createGitHubProvider(CONFIG);
  const url = provider.authorizationUrl(STATE, REDIRECT_URI);

  assertStringIncludes(url, "redirect_uri=");
  assertStringIncludes(url, encodeURIComponent(REDIRECT_URI));
});

Deno.test("GitHubProvider: authorizationUrl points to github.com", () => {
  const provider = createGitHubProvider(CONFIG);
  const url = provider.authorizationUrl(STATE, REDIRECT_URI);
  const parsed = new URL(url);

  assertEquals(parsed.hostname, "github.com");
  assertEquals(parsed.pathname, "/login/oauth/authorize");
});

Deno.test("GitHubProvider: authorizationUrl includes read:user scope", () => {
  const provider = createGitHubProvider(CONFIG);
  const url = provider.authorizationUrl(STATE, REDIRECT_URI);

  assertStringIncludes(url, "scope=");
  // Scope value is URL-encoded
  assertEquals(url.includes("read%3Auser") || url.includes("read:user"), true);
});

Deno.test("GitHubProvider: name is 'github'", () => {
  const provider = createGitHubProvider(CONFIG);
  assertEquals(provider.name, "github");
});

Deno.test("GitHubProvider: different states produce different URLs", () => {
  const provider = createGitHubProvider(CONFIG);
  const url1 = provider.authorizationUrl("state-aaa", REDIRECT_URI);
  const url2 = provider.authorizationUrl("state-bbb", REDIRECT_URI);

  assertEquals(url1 !== url2, true);
});
