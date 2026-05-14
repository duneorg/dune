/**
 * Rate limiting utilities.
 *
 * `RateLimiter` can operate in two modes:
 *
 *   1. Legacy synchronous mode (no store): the constructor takes `maxRequests`
 *      and `windowMs` directly. `check()` is synchronous and state lives in
 *      the current process only. This preserves exact backward compatibility
 *      for all existing call sites.
 *
 *   2. Store-backed async mode: pass a `RateLimitStore` to the constructor.
 *      `checkAsync()` delegates to the store and is safe for multi-process
 *      deployments. `recordFailure()`, `isLocked()`, and `clearFailures()`
 *      are delegating wrappers over the store's methods.
 *
 * When `login.tsx` uses the store-backed path it calls `checkAsync()` (async)
 * instead of `check()` (sync). The sync path is kept intact so existing tests
 * and other callers continue to work without modification.
 */

import type { RateLimitStore } from "./rate-limit-store.ts";

export type { RateLimitStore } from "./rate-limit-store.ts";

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private buckets = new Map<string, RateLimitBucket>();
  private readonly store?: RateLimitStore;
  private readonly _maxRequests: number;
  private readonly _windowMs: number;

  /**
   * @param maxRequests Maximum requests allowed per window
   * @param windowMs    Window length in milliseconds
   * @param store       Optional RateLimitStore for multi-process deployments
   */
  constructor(maxRequests: number, windowMs: number, store?: RateLimitStore) {
    this._maxRequests = maxRequests;
    this._windowMs = windowMs;
    this.store = store;
  }

  /**
   * Synchronous in-process check. Returns true if the key is within the
   * allowed rate, false if limited.
   *
   * When key is "unknown" (no resolvable IP) the check is skipped and true
   * is always returned — otherwise all clients without a proxy header share
   * one bucket and a flood from one client can deny everyone else.
   *
   * This method uses only the in-process bucket map regardless of whether a
   * store is configured. Use `checkAsync()` for the store-backed path.
   */
  check(key: string): boolean {
    if (key === "unknown") return true;
    const now = Date.now();
    const bucket = this.buckets.get(key);

    if (!bucket || now >= bucket.resetAt) {
      this.buckets.set(key, { count: 1, resetAt: now + this._windowMs });
      return true;
    }

    if (bucket.count >= this._maxRequests) {
      return false;
    }

    bucket.count++;
    return true;
  }

  /**
   * Async check delegating to the configured store.
   * Falls back to the synchronous in-process check when no store is set.
   */
  async checkAsync(key: string): Promise<{ allowed: boolean; retryAfter: number }> {
    if (key === "unknown") return { allowed: true, retryAfter: 0 };

    if (this.store) {
      return this.store.check(key, this._maxRequests, this._windowMs);
    }

    // No store — delegate to the sync method for single-process behaviour.
    const allowed = this.check(key);
    const retryAfter = allowed ? 0 : this.retryAfter(key);
    return { allowed, retryAfter };
  }

  /** Returns the number of seconds until the window resets for a key. */
  retryAfter(key: string): number {
    const bucket = this.buckets.get(key);
    if (!bucket) return 0;
    return Math.ceil(Math.max(0, bucket.resetAt - Date.now()) / 1000);
  }

  // ── Failure tracking (delegates to store when present) ─────────────────────

  /**
   * Record a failure event for `key`. Returns the total failure count within
   * the configured window.
   *
   * Falls back to a no-op returning 0 when no store is configured (the
   * per-account lockout in login.tsx maintains its own Map in that case).
   */
  async recordFailure(key: string, windowMs?: number): Promise<number> {
    if (!this.store) return 0;
    return this.store.recordFailure(key, windowMs ?? this._windowMs);
  }

  /**
   * Returns true if the failure count for `key` within `windowMs` is at or
   * above `threshold`.
   */
  async isLocked(key: string, threshold: number, windowMs?: number): Promise<boolean> {
    if (!this.store) return false;
    return this.store.isLocked(key, threshold, windowMs ?? this._windowMs);
  }

  /** Clear failure history for `key` (e.g. on successful login). */
  async clearFailures(key: string): Promise<void> {
    if (this.store) {
      await this.store.clearFailures(key);
    }
  }
}

/**
 * Extract a client IP from a Request for use as a rate-limit bucket key.
 * Falls back to "unknown" when no IP header is available.
 *
 * `x-forwarded-for` / `x-real-ip` can be spoofed by clients unless the
 * deployment sits behind a trusted reverse proxy. By default we IGNORE
 * those headers and fall back to "unknown" (which still rate-limits, but
 * collapses every direct caller into a single bucket — that's intentional;
 * the per-process rate limit then trips immediately under flood).
 *
 * Operators that terminate TLS at a known load balancer should set
 * `system.trusted_proxies: true` (boolean) or list specific proxy
 * addresses in their reverse proxy and configure the limiter via
 * `clientIpFromRequest({ trustForwardedFor: true })`.
 */
export interface ClientIpOptions {
  /** Honor X-Forwarded-For / X-Real-IP. Only set when behind a trusted edge. */
  trustForwardedFor?: boolean;
}

export function clientIp(req: Request, opts: ClientIpOptions = {}): string {
  if (opts.trustForwardedFor) {
    const fwd = req.headers.get("x-forwarded-for");
    if (fwd) return fwd.split(",")[0].trim();
    const real = req.headers.get("x-real-ip");
    if (real) return real.trim();
  }
  return "unknown";
}

/**
 * Build a 429 Too Many Requests response with a Retry-After header.
 */
export function rateLimitResponse(retryAfterSeconds: number, message = "Too many requests"): Response {
  return new Response(message, {
    status: 429,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Retry-After": String(Math.max(1, retryAfterSeconds)),
    },
  });
}
