/**
 * In-memory token-bucket style rate limiter.
 *
 * Keyed by an arbitrary string bucket (usually an IP address). State lives
 * in a single process — sufficient for single-instance deployments. For
 * multi-instance production behind a load balancer, swap in a KV-backed
 * implementation with the same interface.
 */

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private buckets = new Map<string, RateLimitBucket>();

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number,
  ) {}

  /** Returns true if the key is within the allowed rate, false if limited. */
  check(key: string): boolean {
    const now = Date.now();
    const bucket = this.buckets.get(key);

    if (!bucket || now >= bucket.resetAt) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }

    if (bucket.count >= this.maxRequests) {
      return false;
    }

    bucket.count++;
    return true;
  }

  /** Returns the number of seconds until the window resets for a key. */
  retryAfter(key: string): number {
    const bucket = this.buckets.get(key);
    if (!bucket) return 0;
    return Math.ceil(Math.max(0, bucket.resetAt - Date.now()) / 1000);
  }
}

/**
 * Extract a client IP from a Request for use as a rate-limit bucket key.
 * Falls back to "unknown" when no IP header is available.
 *
 * NOTE: `x-forwarded-for` / `x-real-ip` can be spoofed by clients unless the
 * deployment sits behind a trusted reverse proxy. Callers should only rely on
 * these headers when the edge is trusted.
 */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
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
