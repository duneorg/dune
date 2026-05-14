/**
 * Rate-limit store interface and implementations.
 *
 * Abstracts the stateful counters used by the login rate limiter and
 * per-account failure tracker so they can be shared across processes.
 *
 * Backends:
 *   - LocalRateLimitStore  — in-memory Maps, single-process (default)
 *   - KVRateLimitStore     — Deno KV, multi-process safe
 *   - RedisRateLimitStore  — Redis, multi-process safe (requires ioredis)
 */

// ── Interface ──────────────────────────────────────────────────────────────────

export interface RateLimitStore {
  /**
   * Atomically check and increment the request counter for `key`.
   * Returns `allowed: true` when the counter is still within `maxRequests`
   * for the current `windowMs`, or `allowed: false` when the limit is reached.
   * `retryAfter` is the number of seconds until the window resets (0 when allowed).
   */
  check(
    key: string,
    maxRequests: number,
    windowMs: number,
  ): Promise<{ allowed: boolean; retryAfter: number }>;

  /**
   * Record a single failure event for `key` (e.g. a bad login attempt).
   * Returns the total number of failures recorded within `windowMs`.
   */
  recordFailure(key: string, windowMs: number): Promise<number>;

  /**
   * Return true if the failure count for `key` within `windowMs` is at or
   * above `threshold`.
   */
  isLocked(key: string, threshold: number, windowMs: number): Promise<boolean>;

  /**
   * Clear all recorded failures for `key` (called on successful login).
   */
  clearFailures(key: string): Promise<void>;
}

// ── Local (in-memory) implementation ──────────────────────────────────────────

interface RateBucket {
  count: number;
  resetAt: number;
}

/**
 * In-memory rate-limit store backed by plain Maps.
 *
 * State is scoped to a single process. Use KVRateLimitStore or
 * RedisRateLimitStore for multi-process / load-balanced deployments.
 */
export class LocalRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, RateBucket>();
  private readonly failures = new Map<string, number[]>();

  async check(
    key: string,
    maxRequests: number,
    windowMs: number,
  ): Promise<{ allowed: boolean; retryAfter: number }> {
    const now = Date.now();
    const bucket = this.buckets.get(key);

    if (!bucket || now >= bucket.resetAt) {
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true, retryAfter: 0 };
    }

    if (bucket.count >= maxRequests) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      return { allowed: false, retryAfter: Math.max(1, retryAfter) };
    }

    bucket.count++;
    return { allowed: true, retryAfter: 0 };
  }

  async recordFailure(key: string, windowMs: number): Promise<number> {
    const now = Date.now();
    const arr = this.failures.get(key) ?? [];
    const recent = arr.filter((t) => now - t < windowMs);
    recent.push(now);
    this.failures.set(key, recent);
    return recent.length;
  }

  async isLocked(key: string, threshold: number, windowMs: number): Promise<boolean> {
    const now = Date.now();
    const arr = this.failures.get(key);
    if (!arr) return false;
    const recent = arr.filter((t) => now - t < windowMs);
    return recent.length >= threshold;
  }

  async clearFailures(key: string): Promise<void> {
    this.failures.delete(key);
  }
}

// ── Deno KV implementation ─────────────────────────────────────────────────────

interface KVBucket {
  count: number;
  resetAt: number;
}

/**
 * Deno KV-backed rate-limit store.
 *
 * Key layout:
 *   ["rl", key]       → { count, resetAt }  (with TTL matching the window)
 *   ["rl_fail", key]  → number[]            (timestamps of recent failures)
 *
 * The check() method uses an optimistic atomic compare-and-swap loop to
 * avoid TOCTOU races when multiple processes hit the same bucket.
 */
export class KVRateLimitStore implements RateLimitStore {
  constructor(private readonly kv: Deno.Kv) {}

  async check(
    key: string,
    maxRequests: number,
    windowMs: number,
  ): Promise<{ allowed: boolean; retryAfter: number }> {
    const dbKey = ["rl", key] as const;
    const now = Date.now();

    // Optimistic CAS loop — retry if another writer commits simultaneously.
    for (let attempt = 0; attempt < 10; attempt++) {
      const entry = await this.kv.get<KVBucket>(dbKey);
      const bucket = entry.value;

      if (!bucket || now >= bucket.resetAt) {
        // Start a fresh window.
        const newBucket: KVBucket = { count: 1, resetAt: now + windowMs };
        const result = await this.kv.atomic()
          .check(entry)
          .set(dbKey, newBucket, { expireIn: windowMs })
          .commit();
        if (result.ok) return { allowed: true, retryAfter: 0 };
        continue; // CAS lost — retry
      }

      if (bucket.count >= maxRequests) {
        const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
        return { allowed: false, retryAfter: Math.max(1, retryAfter) };
      }

      const updated: KVBucket = { ...bucket, count: bucket.count + 1 };
      const ttlMs = Math.max(1, bucket.resetAt - now);
      const result = await this.kv.atomic()
        .check(entry)
        .set(dbKey, updated, { expireIn: ttlMs })
        .commit();
      if (result.ok) return { allowed: true, retryAfter: 0 };
      // CAS lost — retry
    }

    // All retries exhausted — fail open to avoid blocking legitimate traffic.
    return { allowed: true, retryAfter: 0 };
  }

  async recordFailure(key: string, windowMs: number): Promise<number> {
    const dbKey = ["rl_fail", key] as const;
    const now = Date.now();

    for (let attempt = 0; attempt < 10; attempt++) {
      const entry = await this.kv.get<number[]>(dbKey);
      const arr = entry.value ?? [];
      const recent = arr.filter((t) => now - t < windowMs);
      recent.push(now);

      const result = await this.kv.atomic()
        .check(entry)
        .set(dbKey, recent, { expireIn: windowMs })
        .commit();
      if (result.ok) return recent.length;
    }

    return 0;
  }

  async isLocked(key: string, threshold: number, windowMs: number): Promise<boolean> {
    const dbKey = ["rl_fail", key] as const;
    const entry = await this.kv.get<number[]>(dbKey);
    if (!entry.value) return false;
    const now = Date.now();
    const recent = entry.value.filter((t) => now - t < windowMs);
    return recent.length >= threshold;
  }

  async clearFailures(key: string): Promise<void> {
    await this.kv.delete(["rl_fail", key]);
  }
}

// ── Redis implementation ───────────────────────────────────────────────────────

/** Minimal Redis client interface (compatible with ioredis). */
export interface RedisRateLimitClient {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  ttl(key: string): Promise<number>;
  /**
   * SET key value [NX] [EX seconds]
   *
   * Returns the value that was set, or null when NX was specified and the key
   * already existed (i.e. the SET was not performed).
   */
  set(key: string, value: string, ...args: string[]): Promise<string | null>;
  lpush(key: string, ...values: string[]): Promise<unknown>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  del(...keys: string[]): Promise<unknown>;
}

const RL_PREFIX = "dune:rl:";
const FAIL_PREFIX = "dune:fail:";

/**
 * Redis-backed rate-limit store using an ioredis-compatible client.
 *
 * Rate limiting uses an atomic SET NX EX + INCR pattern:
 *   1. SET key 1 NX EX windowSecs  → initialises a new window atomically
 *   2. If the key already existed, INCR it and check against the limit
 *
 * This avoids the race in the plain INCR+EXPIRE pattern where a concurrent
 * request can INCR before EXPIRE runs, creating a key that never expires.
 *
 * Failure tracking uses a Redis List of timestamps; isLocked() filters
 * to within the rolling window client-side.
 */
export class RedisRateLimitStore implements RateLimitStore {
  constructor(private readonly client: RedisRateLimitClient) {}

  async check(
    key: string,
    maxRequests: number,
    windowMs: number,
  ): Promise<{ allowed: boolean; retryAfter: number }> {
    const rlKey = `${RL_PREFIX}${key}`;
    const windowSecs = String(Math.ceil(windowMs / 1000));

    // Attempt to atomically initialise a new window.
    // SET NX EX returns "OK" when the key was created, null when it already existed.
    const initialised = await this.client.set(rlKey, "1", "NX", "EX", windowSecs);

    if (initialised !== null) {
      // New window, first request — always allowed.
      return { allowed: true, retryAfter: 0 };
    }

    // Key already exists — increment and check.
    const count = await this.client.incr(rlKey);

    if (count > maxRequests) {
      const ttl = await this.client.ttl(rlKey);
      return { allowed: false, retryAfter: Math.max(1, ttl) };
    }

    return { allowed: true, retryAfter: 0 };
  }

  async recordFailure(key: string, windowMs: number): Promise<number> {
    const failKey = `${FAIL_PREFIX}${key}`;
    const windowSec = Math.ceil(windowMs / 1000);
    const now = Date.now();

    await this.client.lpush(failKey, String(now));
    await this.client.expire(failKey, windowSec);

    // Fetch all entries and count those within the rolling window.
    const entries = await this.client.lrange(failKey, 0, -1);
    const cutoff = now - windowMs;
    return entries.filter((t) => Number(t) > cutoff).length;
  }

  async isLocked(key: string, threshold: number, windowMs: number): Promise<boolean> {
    const failKey = `${FAIL_PREFIX}${key}`;
    const entries = await this.client.lrange(failKey, 0, -1);
    const now = Date.now();
    const cutoff = now - windowMs;
    const recent = entries.filter((t) => Number(t) > cutoff);
    return recent.length >= threshold;
  }

  async clearFailures(key: string): Promise<void> {
    await this.client.del(`${FAIL_PREFIX}${key}`);
  }
}
