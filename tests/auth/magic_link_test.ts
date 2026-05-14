/**
 * Tests for magic link token creation and verification.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createMagicLink, verifyMagicToken } from "../../src/auth/magic-link.ts";

const SECRET = "test-secret-for-magic-link";
const BASE_URL = "https://example.com";

Deno.test("createMagicLink: returns a valid URL", async () => {
  const link = await createMagicLink("user@example.com", SECRET, BASE_URL);
  const url = new URL(link);

  assertEquals(url.pathname, "/auth/magic");
  assertEquals(typeof url.searchParams.get("token"), "string");
  assertEquals((url.searchParams.get("token") ?? "").length > 0, true);
});

Deno.test("createMagicLink: token has two parts separated by dot", async () => {
  const link = await createMagicLink("user@example.com", SECRET, BASE_URL);
  const token = new URL(link).searchParams.get("token") ?? "";
  const parts = token.split(".");

  assertEquals(parts.length, 2);
  assertEquals(parts[0].length > 0, true);
  assertEquals(parts[1].length > 0, true);
});

Deno.test("verifyMagicToken: valid token returns email", async () => {
  const link = await createMagicLink("hello@example.com", SECRET, BASE_URL);
  const token = new URL(link).searchParams.get("token") ?? "";

  const result = await verifyMagicToken(token, SECRET);
  assertEquals(result !== null, true);
  assertEquals(result!.email, "hello@example.com");
});

Deno.test("verifyMagicToken: wrong secret returns null", async () => {
  const link = await createMagicLink("user@example.com", SECRET, BASE_URL);
  const token = new URL(link).searchParams.get("token") ?? "";

  const result = await verifyMagicToken(token, "wrong-secret");
  assertEquals(result, null);
});

Deno.test("verifyMagicToken: tampered payload returns null", async () => {
  const link = await createMagicLink("user@example.com", SECRET, BASE_URL);
  const token = new URL(link).searchParams.get("token") ?? "";

  // Replace the payload part with a different one
  const dotIndex = token.lastIndexOf(".");
  const sig = token.slice(dotIndex);
  // Base64url encode a different email
  const fakePaylod = btoa(JSON.stringify({ email: "evil@example.com", exp: Date.now() + 999999 }))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  const tampered = fakePaylod + sig;

  const result = await verifyMagicToken(tampered, SECRET);
  assertEquals(result, null);
});

Deno.test("verifyMagicToken: expired token returns null", async () => {
  // We can't easily fake time, so we create a custom expired token manually.
  // The token format is base64url(JSON({email, exp})).base64url(sig)
  // We'll create a valid token, then modify the exp to be in the past.
  // Since we can't re-sign with the right signature, test the signature check catches it.
  // Separately, test with a very-short-lived token and wait.

  // Use a negative lifetime indirectly by creating a token with exp = now - 1
  // This requires we build it manually. Instead, verify via integration:
  // Just verify the wrong-secret path covers tampered tokens, and test
  // that a future-valid token is verified correctly (indirect proof).

  // For direct expiry test: build a token where the payload has exp in the past.
  // We need to sign it correctly so the signature check passes and the expiry check fails.
  const { encodeBase64Url } = await import("@std/encoding/base64url");
  const { crypto: stdCrypto } = await import("@std/crypto");

  const payload = { email: "expired@example.com", exp: Date.now() - 10000 }; // expired 10s ago
  const payloadB64 = encodeBase64Url(new TextEncoder().encode(JSON.stringify(payload)));

  // Sign it properly
  const keyData = new TextEncoder().encode(SECRET);
  const msgData = new TextEncoder().encode(payloadB64);
  const key = await stdCrypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await stdCrypto.subtle.sign("HMAC", key, msgData);
  const sigB64 = encodeBase64Url(new Uint8Array(sig));
  const expiredToken = `${payloadB64}.${sigB64}`;

  const result = await verifyMagicToken(expiredToken, SECRET);
  assertEquals(result, null);
});

Deno.test("verifyMagicToken: malformed token returns null", async () => {
  assertEquals(await verifyMagicToken("not-a-valid-token", SECRET), null);
  assertEquals(await verifyMagicToken("", SECRET), null);
  assertEquals(await verifyMagicToken("nodot", SECRET), null);
});

Deno.test("createMagicLink: different emails produce different tokens", async () => {
  const link1 = await createMagicLink("a@example.com", SECRET, BASE_URL);
  const link2 = await createMagicLink("b@example.com", SECRET, BASE_URL);
  assertEquals(link1 !== link2, true);
});

Deno.test("verifyMagicToken: tokens from different secrets don't cross-verify", async () => {
  const link = await createMagicLink("user@example.com", "secret-A", BASE_URL);
  const token = new URL(link).searchParams.get("token") ?? "";

  const result = await verifyMagicToken(token, "secret-B");
  assertEquals(result, null);
});
