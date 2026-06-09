/**
 * Tests for verifyExternalJwt.
 * Tests HMAC (HS256) happy path and tampered token rejection.
 * RS256/JWKS is not tested end-to-end (requires network).
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { verifyExternalJwt } from "../../src/auth/jwt.ts";
import { encodeBase64Url } from "@std/encoding/base64url";
import { crypto as stdCrypto } from "@std/crypto";

const SECRET = "test-hmac-secret-for-jwt";

/** Build a minimal HS256 JWT with the given payload. */
async function buildJwt(
  payload: Record<string, unknown>,
  secret: string,
  header?: Record<string, unknown>,
): Promise<string> {
  const h = header ?? { alg: "HS256", typ: "JWT" };
  const headerB64 = encodeBase64Url(new TextEncoder().encode(JSON.stringify(h)));
  const payloadB64 = encodeBase64Url(new TextEncoder().encode(JSON.stringify(payload)));

  const keyData = new TextEncoder().encode(secret);
  const key = await stdCrypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await stdCrypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${headerB64}.${payloadB64}`),
  );
  const sigB64 = encodeBase64Url(new Uint8Array(sig));

  return `${headerB64}.${payloadB64}.${sigB64}`;
}

Deno.test("verifyExternalJwt: valid HS256 token returns claims", async () => {
  const payload = {
    sub: "user-123",
    email: "alice@example.com",
    roles: ["member"],
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  const token = await buildJwt(payload, SECRET);

  const result = await verifyExternalJwt(token, { secret: SECRET });
  assertEquals(result !== null, true);
  assertEquals(result!.userId, "user-123");
  assertEquals(result!.email, "alice@example.com");
  assertEquals(result!.roles, ["member"]);
});

Deno.test("verifyExternalJwt: wrong secret returns null", async () => {
  const payload = { sub: "user-123", exp: Math.floor(Date.now() / 1000) + 3600 };
  const token = await buildJwt(payload, SECRET);

  const result = await verifyExternalJwt(token, { secret: "wrong-secret" });
  assertEquals(result, null);
});

Deno.test("verifyExternalJwt: expired token returns null", async () => {
  const payload = {
    sub: "user-456",
    exp: Math.floor(Date.now() / 1000) - 60, // expired 60s ago
  };
  const token = await buildJwt(payload, SECRET);

  const result = await verifyExternalJwt(token, { secret: SECRET });
  assertEquals(result, null);
});

Deno.test("verifyExternalJwt: tampered payload returns null", async () => {
  const payload = { sub: "user-123", exp: Math.floor(Date.now() / 1000) + 3600 };
  const token = await buildJwt(payload, SECRET);

  // Replace the payload part
  const parts = token.split(".");
  const tamperedPayload = encodeBase64Url(
    new TextEncoder().encode(JSON.stringify({ sub: "attacker", exp: payload.exp })),
  );
  const tampered = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

  const result = await verifyExternalJwt(tampered, { secret: SECRET });
  assertEquals(result, null);
});

Deno.test("verifyExternalJwt: malformed token returns null", async () => {
  assertEquals(await verifyExternalJwt("not-a-jwt", { secret: SECRET }), null);
  assertEquals(await verifyExternalJwt("", { secret: SECRET }), null);
  assertEquals(await verifyExternalJwt("a.b", { secret: SECRET }), null);
});

Deno.test("verifyExternalJwt: custom claim names", async () => {
  const payload = {
    uid: "custom-user-id",
    mail: "bob@example.com",
    groups: ["admin", "premium"],
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  const token = await buildJwt(payload, SECRET);

  const result = await verifyExternalJwt(token, {
    secret: SECRET,
    userIdClaim: "uid",
    emailClaim: "mail",
    rolesClaim: "groups",
  });

  assertEquals(result !== null, true);
  assertEquals(result!.userId, "custom-user-id");
  assertEquals(result!.email, "bob@example.com");
  assertEquals(result!.roles, ["admin", "premium"]);
});

Deno.test("verifyExternalJwt: missing userId claim returns null", async () => {
  const payload = {
    // No "sub" claim
    email: "user@example.com",
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  const token = await buildJwt(payload, SECRET);

  const result = await verifyExternalJwt(token, { secret: SECRET });
  assertEquals(result, null);
});

Deno.test("verifyExternalJwt: roles as single string is wrapped in array", async () => {
  const payload = {
    sub: "user-789",
    roles: "admin", // string, not array
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  const token = await buildJwt(payload, SECRET);

  const result = await verifyExternalJwt(token, { secret: SECRET });
  assertEquals(result !== null, true);
  assertEquals(result!.roles, ["admin"]);
});

Deno.test("verifyExternalJwt: no exp claim is allowed (no expiry enforcement)", async () => {
  // Tokens without exp are treated as non-expiring
  const payload = { sub: "user-noexp" };
  const token = await buildJwt(payload, SECRET);

  const result = await verifyExternalJwt(token, { secret: SECRET });
  assertEquals(result !== null, true);
  assertEquals(result!.userId, "user-noexp");
});

Deno.test("verifyExternalJwt: issuer mismatch returns null (H-1)", async () => {
  const payload = {
    sub: "user-123",
    iss: "https://evil-tenant.example.com",
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  const token = await buildJwt(payload, SECRET);

  // Same signing key, wrong issuer — must be rejected.
  const result = await verifyExternalJwt(token, {
    secret: SECRET,
    issuer: "https://my-tenant.example.com",
  });
  assertEquals(result, null);

  // Matching issuer is accepted.
  const ok = await buildJwt(
    { ...payload, iss: "https://my-tenant.example.com" },
    SECRET,
  );
  const okResult = await verifyExternalJwt(ok, {
    secret: SECRET,
    issuer: "https://my-tenant.example.com",
  });
  assertEquals(okResult?.userId, "user-123");
});

Deno.test("verifyExternalJwt: audience must contain expected value (H-1)", async () => {
  const base = { sub: "user-123", exp: Math.floor(Date.now() / 1000) + 3600 };

  // Token minted for a different app — rejected.
  const wrong = await buildJwt({ ...base, aud: "other-app" }, SECRET);
  assertEquals(
    await verifyExternalJwt(wrong, { secret: SECRET, audience: "my-app" }),
    null,
  );

  // String aud matching.
  const okStr = await buildJwt({ ...base, aud: "my-app" }, SECRET);
  assertEquals(
    (await verifyExternalJwt(okStr, { secret: SECRET, audience: "my-app" }))?.userId,
    "user-123",
  );

  // Array aud containing the expected value.
  const okArr = await buildJwt({ ...base, aud: ["x", "my-app"] }, SECRET);
  assertEquals(
    (await verifyExternalJwt(okArr, { secret: SECRET, audience: "my-app" }))?.userId,
    "user-123",
  );
});

Deno.test("verifyExternalJwt: not-yet-valid (nbf) token returns null", async () => {
  const payload = {
    sub: "user-123",
    nbf: Math.floor(Date.now() / 1000) + 3600, // valid only an hour from now
    exp: Math.floor(Date.now() / 1000) + 7200,
  };
  const token = await buildJwt(payload, SECRET);
  assertEquals(await verifyExternalJwt(token, { secret: SECRET }), null);
});

Deno.test("verifyExternalJwt: pinned algorithm rejects a mismatching alg (M-4)", async () => {
  const payload = { sub: "user-123", exp: Math.floor(Date.now() / 1000) + 3600 };
  const token = await buildJwt(payload, SECRET); // HS256

  // Pinned to RS256 — a valid HS256 token must be rejected.
  assertEquals(
    await verifyExternalJwt(token, { secret: SECRET, algorithm: "RS256" }),
    null,
  );

  // Pinned to HS256 — accepted.
  assertEquals(
    (await verifyExternalJwt(token, { secret: SECRET, algorithm: "HS256" }))?.userId,
    "user-123",
  );
});

Deno.test("verifyExternalJwt: unknown alg returns null when no matching options", async () => {
  const payload = { sub: "user-123", exp: Math.floor(Date.now() / 1000) + 3600 };
  // Build with RS256 header but no jwksUrl configured
  const token = await buildJwt(payload, SECRET, { alg: "RS256", typ: "JWT" });

  const result = await verifyExternalJwt(token, { secret: SECRET });
  assertEquals(result, null);
});
