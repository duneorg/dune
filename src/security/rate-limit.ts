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
