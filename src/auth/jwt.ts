/**
 * External JWT verification for auth.mode = "external-jwt".
 *
 * Supports two verification methods:
 *   1. HMAC-SHA256 with a shared secret
 *   2. RS256 via JWKS endpoint (Clerk, Auth0, etc.)
 *
 * Uses @std/crypto — no JWT library. Minimal: only what Dune needs.
 */

import { decodeBase64Url } from "@std/encoding/base64url";
import { crypto as stdCrypto } from "@std/crypto";

export interface ExternalJwtOptions {
  secret?: string;       // HMAC-SHA256 shared secret
  jwksUrl?: string;      // JWKS endpoint URL
  userIdClaim?: string;  // default "sub"
  emailClaim?: string;   // default "email"
  rolesClaim?: string;   // default "roles"
}

export interface JwtVerifyResult {
  userId: string;
  email?: string;
  roles?: string[];
}

/**
 * Verify an external JWT and extract claims.
 * Returns null on any verification failure — never throws to callers.
 */
export async function verifyExternalJwt(
  token: string,
  opts: ExternalJwtOptions,
): Promise<JwtVerifyResult | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, sigB64] = parts;

    // Decode header to get alg and kid
    const header = decodeJwtPart(headerB64) as { alg?: string; kid?: string };
    if (!header || !header.alg) return null;

    const alg = header.alg;

    // Verify signature
    if (alg === "HS256" && opts.secret) {
      const valid = await verifyHmac(headerB64, payloadB64, sigB64, opts.secret);
      if (!valid) return null;
    } else if (alg === "RS256" && opts.jwksUrl) {
      const valid = await verifyRsa(headerB64, payloadB64, sigB64, opts.jwksUrl, header.kid);
      if (!valid) return null;
    } else {
      // Unsupported alg or missing verification key
      return null;
    }

    // Decode payload
    const payload = decodeJwtPart(payloadB64) as Record<string, unknown>;
    if (!payload) return null;

    // Check exp claim
    if (typeof payload.exp === "number" && Date.now() / 1000 > payload.exp) {
      return null; // expired
    }

    // Extract claims
    const userIdClaim = opts.userIdClaim ?? "sub";
    const emailClaim = opts.emailClaim ?? "email";
    const rolesClaim = opts.rolesClaim ?? "roles";

    const userId = String(payload[userIdClaim] ?? "");
    if (!userId) return null;

    const email = typeof payload[emailClaim] === "string"
      ? (payload[emailClaim] as string)
      : undefined;

    const roles = extractRoles(payload[rolesClaim]);

    return { userId, email, roles };
  } catch {
    return null;
  }
}

/** Decode a base64url JWT part as JSON. Returns null on error. */
function decodeJwtPart(b64: string): Record<string, unknown> | null {
  try {
    const bytes = decodeBase64Url(b64);
    const json = new TextDecoder().decode(bytes);
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Verify HS256 signature. */
async function verifyHmac(
  headerB64: string,
  payloadB64: string,
  sigB64: string,
  secret: string,
): Promise<boolean> {
  const keyData = new TextEncoder().encode(secret);
  const message = new TextEncoder().encode(`${headerB64}.${payloadB64}`);

  const key = await stdCrypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );

  const signature = decodeBase64Url(sigB64);
  return stdCrypto.subtle.verify("HMAC", key, signature, message);
}

/** Verify RS256 signature by fetching JWKS and finding the matching key. */
async function verifyRsa(
  headerB64: string,
  payloadB64: string,
  sigB64: string,
  jwksUrl: string,
  kid?: string,
): Promise<boolean> {
  let jwks: { keys: JwkKey[] };
  try {
    const res = await fetch(jwksUrl, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return false;
    jwks = await res.json() as { keys: JwkKey[] };
  } catch {
    return false;
  }

  if (!Array.isArray(jwks.keys) || jwks.keys.length === 0) return false;

  // Find matching key by kid, or use the first key if no kid
  const jwk = kid
    ? jwks.keys.find((k) => k.kid === kid)
    : jwks.keys[0];

  if (!jwk) return false;

  try {
    const key = await stdCrypto.subtle.importKey(
      "jwk",
      jwk as JsonWebKey,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );

    const message = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const signature = decodeBase64Url(sigB64);

    return stdCrypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, message);
  } catch {
    return false;
  }
}

interface JwkKey {
  kty: string;
  kid?: string;
  use?: string;
  alg?: string;
  n?: string;
  e?: string;
}

/** Extract roles from a JWT claim — handles string, string[], or undefined. */
function extractRoles(value: unknown): string[] | undefined {
  if (!value) return undefined;
  if (Array.isArray(value)) {
    return value.filter((v) => typeof v === "string") as string[];
  }
  if (typeof value === "string") {
    return [value];
  }
  return undefined;
}
