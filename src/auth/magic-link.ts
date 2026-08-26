/**
 * Magic link auth — stateless HMAC-SHA256 signed tokens.
 *
 * Token format (URL-safe):
 *   base64url(JSON({ email, exp, nonce })) + "." + base64url(HMAC-SHA256 signature)
 *
 * No database storage needed for signature/expiry — those are embedded in the token.
 * Tokens are single-use: verification claims the token's nonce in an in-memory
 * store (a shared MagicTokenStore can be passed for multi-process deployments).
 *
 * Default lifetime: 15 minutes.
 */

import { encodeBase64Url, decodeBase64Url } from "@std/encoding/base64url";
import { encodeHex } from "@std/encoding/hex";
import { crypto as stdCrypto } from "@std/crypto";
import { timingSafeEqualStrings } from "../security/timing-safe.ts";

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
   * Mark a nonce as used. Returns `true` if this caller newly recorded it
   * (SET NX), `false` if it was already present and unexpired.
   * The store may evict entries once `expiresAtMs` has passed.
   */
  add(nonce: string, expiresAtMs: number): Promise<boolean>;
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

  async add(nonce: string, expiresAtMs: number): Promise<boolean> {
    this.evict();
    const existing = this.used.get(nonce);
    if (existing !== undefined && Date.now() < existing) return false;
    this.used.set(nonce, expiresAtMs);
    return true;
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
 * Default single-use store applied by {@link verifyMagicToken} when the caller
 * does not supply one. Module-level so every call site in the process shares
 * one nonce set (multi-process deployments should still pass an explicit
 * shared store backed by KV or Redis).
 */
const defaultTokenStore = new InMemoryMagicTokenStore();

/**
 * Verify a magic link token.
 *
 * Tokens are single-use by default: the first successful verification marks
 * the token's nonce as used in the shared in-memory store and subsequent calls
 * with the same token return null. Multi-process or serverless deployments
 * should pass an explicit `store` backed by Deno KV or Redis so all instances
 * agree on which nonces have been consumed.
 *
 * @returns `{ email }` on success, `null` when invalid, expired, or already used.
 */
export async function verifyMagicToken(
  token: string,
  secret: string,
  store: MagicTokenStore = defaultTokenStore,
): Promise<{ email: string } | null> {
  const dotIndex = token.lastIndexOf(".");
  if (dotIndex === -1) return null;

  const payloadB64 = token.slice(0, dotIndex);
  const providedSig = token.slice(dotIndex + 1);

  // Verify signature
  const expectedSig = await sign(payloadB64, secret);
  if (!timingSafeEqualStrings(expectedSig, providedSig)) return null;

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

  // Single-use enforcement: atomically claim the nonce (SET NX).
  if (store && payload.nonce) {
    const inserted = await store.add(payload.nonce, payload.exp);
    if (!inserted) return null;
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
