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
import { safeFetch } from "../security/ssrf.ts";

export interface ExternalJwtOptions {
  secret?: string;       // HMAC-SHA256 shared secret
  jwksUrl?: string;      // JWKS endpoint URL
  userIdClaim?: string;  // default "sub"
  emailClaim?: string;   // default "email"
  rolesClaim?: string;   // default "roles"
  /**
   * Expected `iss` claim. When set, a token whose `iss` does not match exactly
   * is rejected. Strongly recommended: without it, any token signed by the same
   * IdP (e.g. another tenant on a shared JWKS) is accepted.
   */
  issuer?: string;
  /**
   * Expected `aud` claim. When set, the token's `aud` (string or string[]) must
   * contain this value. Prevents tokens minted for a different application that
   * shares the IdP's signing keys from being accepted here.
   */
  audience?: string;
  /**
   * Pin the accepted signing algorithm. When set, a token whose header `alg`
   * does not match is rejected before any key is consulted — defense-in-depth
   * against algorithm-substitution attacks. Defaults to inferring from which
   * key material is configured (HS256 with `secret`, RS256 with `jwksUrl`).
   */
  algorithm?: "HS256" | "RS256";
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

    // Pin the algorithm when configured — reject mismatches before touching
    // any key material.
    if (opts.algorithm && alg !== opts.algorithm) return null;

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

    const nowSec = Date.now() / 1000;

    // Check exp claim
    if (typeof payload.exp === "number" && nowSec > payload.exp) {
      return null; // expired
    }

    // Check nbf ("not before") claim — reject tokens used before they're valid.
    // Allow a small clock-skew tolerance to avoid false rejections.
    if (typeof payload.nbf === "number" && nowSec + 60 < payload.nbf) {
      return null;
    }

    // Validate issuer when configured — a token from a different issuer on a
    // shared signing key must not be accepted.
    if (opts.issuer && payload.iss !== opts.issuer) {
      return null;
    }

    // Validate audience when configured — `aud` may be a string or string[].
    if (opts.audience && !audienceMatches(payload.aud, opts.audience)) {
      return null;
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
    // SSRF guard: a misconfigured or attacker-influenced jwksUrl must not be
    // able to reach internal/loopback/metadata endpoints during verification.
    const res = await safeFetch(jwksUrl, { signal: AbortSignal.timeout(5000) });
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

/** True when the token `aud` claim (string or string[]) contains `expected`. */
function audienceMatches(aud: unknown, expected: string): boolean {
  if (typeof aud === "string") return aud === expected;
  if (Array.isArray(aud)) return aud.includes(expected);
  return false;
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
