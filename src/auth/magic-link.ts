/**
 * Magic link auth — stateless HMAC-SHA256 signed tokens.
 *
 * Token format (URL-safe):
 *   base64url(JSON({ email, exp, nonce })) + "." + base64url(HMAC-SHA256 signature)
 *
 * No database storage needed for signature/expiry — those are embedded in the token.
 * For single-use enforcement pass a MagicTokenStore; without one tokens are multi-use
 * for the full 15-minute lifetime.
 *
 * Default lifetime: 15 minutes.
 */

import { encodeBase64Url, decodeBase64Url } from "@std/encoding/base64url";
import { encodeHex } from "@std/encoding/hex";
import { crypto as stdCrypto } from "@std/crypto";

const TOKEN_LIFETIME_MS = 15 * 60 * 1000; // 15 minutes

interface TokenPayload {
  email: string;
  exp: number; // ms timestamp
  nonce: string; // random hex — used for single-use enforcement
}

// ── Single-use token store ────────────────────────────────────────────────────

/**
 * Store interface for tracking single-use magic link tokens.
 *
 * The default `InMemoryMagicTokenStore` is suitable for single-process
 * deployments. Multi-process or serverless deployments should provide a
 * shared store backed by Deno KV, Redis, or similar.
 */
export interface MagicTokenStore {
  /** Returns true if the nonce has already been used. */
  has(nonce: string): Promise<boolean>;
  /**
   * Mark a nonce as used.
   * The store may evict entries once `expiresAtMs` has passed.
   */
  add(nonce: string, expiresAtMs: number): Promise<void>;
}

/**
 * In-memory single-use token store with automatic TTL eviction.
 *
 * Safe for single-process deployments. A server restart clears all state,
 * which is acceptable — tokens are short-lived (15 min) and invalidation
 * on restart is safe behaviour.
 */
export class InMemoryMagicTokenStore implements MagicTokenStore {
  private readonly used = new Map<string, number>(); // nonce → expiresAtMs

  async has(nonce: string): Promise<boolean> {
    const exp = this.used.get(nonce);
    if (exp === undefined) return false;
    if (Date.now() >= exp) {
      this.used.delete(nonce);
      return false; // expired — token would also fail the exp check
    }
    return true;
  }

  async add(nonce: string, expiresAtMs: number): Promise<void> {
    this.used.set(nonce, expiresAtMs);
    this.evict();
  }

  /** Evict all expired entries to prevent unbounded growth. */
  private evict(): void {
    const now = Date.now();
    for (const [n, exp] of this.used) {
      if (now >= exp) this.used.delete(n);
    }
  }
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
  const nonce = encodeHex(crypto.getRandomValues(new Uint8Array(16)));
  const payload: TokenPayload = {
    email,
    exp: Date.now() + TOKEN_LIFETIME_MS,
    nonce,
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
 *
 * When `store` is provided the token is treated as single-use: the first
 * successful verification marks the nonce as used and subsequent calls with
 * the same token return null.
 *
 * Without a store tokens remain valid for their full 15-minute lifetime, which
 * is acceptable for low-risk deployments but should be avoided in production.
 *
 * @returns `{ email }` on success, `null` when invalid, expired, or already used.
 */
export async function verifyMagicToken(
  token: string,
  secret: string,
  store?: MagicTokenStore,
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

  // Single-use enforcement: check and mark the nonce in the store.
  if (store && payload.nonce) {
    if (await store.has(payload.nonce)) {
      return null; // already used
    }
    await store.add(payload.nonce, payload.exp);
  }

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

/**
 * Constant-time comparison of two base64url-encoded HMAC signatures.
 *
 * Uses `Uint8Array` byte comparison so the loop executes the same number of
 * iterations regardless of where a mismatch occurs, preventing timing attacks.
 *
 * Both arguments are base64url-encoded SHA-256 outputs (always 43 bytes after
 * encoding), so the early-exit length check is a non-issue in practice. The
 * `Uint8Array` encoding ensures the comparison is byte-accurate even if the
 * strings contain multi-byte characters.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);
  if (aBytes.byteLength !== bBytes.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.byteLength; i++) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}
