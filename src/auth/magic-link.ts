/**
 * Magic link auth — stateless HMAC-SHA256 signed tokens.
 *
 * Token format (URL-safe):
 *   base64url(JSON({ email, exp })) + "." + base64url(HMAC-SHA256 signature)
 *
 * No database storage needed — the signature and expiry are embedded in the token.
 * Default lifetime: 15 minutes.
 */

import { encodeBase64Url, decodeBase64Url } from "@std/encoding/base64url";
import { crypto as stdCrypto } from "@std/crypto";

const TOKEN_LIFETIME_MS = 15 * 60 * 1000; // 15 minutes

interface TokenPayload {
  email: string;
  exp: number; // ms timestamp
}

/**
 * Create a signed magic link URL.
 * @param email - Recipient email address
 * @param secret - HMAC secret (from site config)
 * @param baseUrl - Base URL of the site, e.g. "https://example.com"
 * @returns Full magic link URL, e.g. "https://example.com/auth/magic?token=..."
 */
export async function createMagicLink(
  email: string,
  secret: string,
  baseUrl: string,
): Promise<string> {
  const payload: TokenPayload = {
    email,
    exp: Date.now() + TOKEN_LIFETIME_MS,
  };

  const payloadB64 = encodeBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await sign(payloadB64, secret);
  const token = `${payloadB64}.${sig}`;

  const url = new URL("/auth/magic", baseUrl);
  url.searchParams.set("token", token);
  return url.toString();
}

/**
 * Verify a magic link token.
 * Returns the email if valid, null if expired or invalid.
 */
export async function verifyMagicToken(
  token: string,
  secret: string,
): Promise<{ email: string } | null> {
  const dotIndex = token.lastIndexOf(".");
  if (dotIndex === -1) return null;

  const payloadB64 = token.slice(0, dotIndex);
  const providedSig = token.slice(dotIndex + 1);

  // Verify signature
  const expectedSig = await sign(payloadB64, secret);
  if (!timingSafeEqual(expectedSig, providedSig)) return null;

  // Decode payload
  let payload: TokenPayload;
  try {
    const raw = new TextDecoder().decode(decodeBase64Url(payloadB64));
    payload = JSON.parse(raw) as TokenPayload;
  } catch {
    return null;
  }

  // Check expiry
  if (Date.now() > payload.exp) return null;

  if (!payload.email || typeof payload.email !== "string") return null;

  return { email: payload.email };
}

/** HMAC-SHA256 sign a message. Returns base64url-encoded signature. */
async function sign(message: string, secret: string): Promise<string> {
  const keyData = new TextEncoder().encode(secret);
  const msgData = new TextEncoder().encode(message);

  const key = await stdCrypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await stdCrypto.subtle.sign("HMAC", key, msgData);
  return encodeBase64Url(new Uint8Array(signature));
}

/** Constant-time string comparison to prevent timing attacks. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still do a dummy comparison to avoid timing leaks on length difference
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ (b.charCodeAt(i % b.length));
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
