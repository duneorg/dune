/**
 * Tests for rate-limit store implementations.
 *
 * Covers:
 *   - LocalRateLimitStore (in-memory)
 *   - KVRateLimitStore (Deno KV in-memory)
 *
 * Redis tests: require an external Redis service — run manually with REDIS_URL set.
 */

import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { LocalRateLimitStore, KVRateLimitStore } from "../../src/security/rate-limit-store.ts";

// ── LocalRateLimitStore ────────────────────────────────────────────────────────

Deno.test("LocalRateLimitStore: check allows requests within limit", async () => {
  const store = new LocalRateLimitStore();
  const { allowed } = await store.check("1.1.1.1", 3, 60_000);
  assert(allowed);
});

Deno.test("LocalRateLimitStore: check blocks at limit", async () => {
  const store = new LocalRateLimitStore();
  await store.check("1.1.1.1", 2, 60_000);
  await store.check("1.1.1.1", 2, 60_000);
  const { allowed } = await store.check("1.1.1.1", 2, 60_000);
  assertFalse(allowed);
});

Deno.test("LocalRateLimitStore: check tracks keys independently", async () => {
  const store = new LocalRateLimitStore();
  await store.check("a", 1, 60_000); // exhaust bucket for "a"
  await store.check("a", 1, 60_000);
  const resA = await store.check("a", 1, 60_000);
  const resB = await store.check("b", 1, 60_000);
  assertFalse(resA.allowed);
  assert(resB.allowed);
});

Deno.test("LocalRateLimitStore: check resets after window", async () => {
  const store = new LocalRateLimitStore();
  await store.check("ip", 1, 50);  // window = 50ms
  await store.check("ip", 1, 50);  // should be blocked
  await new Promise((r) => setTimeout(r, 60));
  const { allowed } = await store.check("ip", 1, 50);
  assert(allowed);
});

Deno.test("LocalRateLimitStore: blocked check returns retryAfter > 0", async () => {
  const store = new LocalRateLimitStore();
  await store.check("ip", 1, 5_000);
  await store.check("ip", 1, 5_000);
  const { allowed, retryAfter } = await store.check("ip", 1, 5_000);
  assertFalse(allowed);
  assert(retryAfter >= 1);
});

Deno.test("LocalRateLimitStore: recordFailure accumulates count", async () => {
  const store = new LocalRateLimitStore();
  const c1 = await store.recordFailure("user-x", 60_000);
  const c2 = await store.recordFailure("user-x", 60_000);
  assertEquals(c1, 1);
  assertEquals(c2, 2);
});

Deno.test("LocalRateLimitStore: isLocked returns false below threshold", async () => {
  const store = new LocalRateLimitStore();
  await store.recordFailure("u", 60_000);
  assertFalse(await store.isLocked("u", 3, 60_000));
});

Deno.test("LocalRateLimitStore: isLocked returns true at threshold", async () => {
  const store = new LocalRateLimitStore();
  await store.recordFailure("u", 60_000);
  await store.recordFailure("u", 60_000);
  await store.recordFailure("u", 60_000);
  assert(await store.isLocked("u", 3, 60_000));
});

Deno.test("LocalRateLimitStore: isLocked ignores failures outside window", async () => {
  const store = new LocalRateLimitStore();
  // Record failures with a very short window, then check against a later window
  await store.recordFailure("u", 50);  // 50ms window
  await store.recordFailure("u", 50);
  await store.recordFailure("u", 50);
  await new Promise((r) => setTimeout(r, 60));
  // After the window expires, isLocked should return false
  assertFalse(await store.isLocked("u", 3, 50));
});

Deno.test("LocalRateLimitStore: clearFailures resets the counter", async () => {
  const store = new LocalRateLimitStore();
  await store.recordFailure("u", 60_000);
  await store.recordFailure("u", 60_000);
  await store.recordFailure("u", 60_000);
  await store.clearFailures("u");
  assertFalse(await store.isLocked("u", 3, 60_000));
});

Deno.test("LocalRateLimitStore: clearFailures is a no-op for unknown key", async () => {
  const store = new LocalRateLimitStore();
  await store.clearFailures("never-seen");
});

// ── KVRateLimitStore ───────────────────────────────────────────────────────────

Deno.test("KVRateLimitStore: check allows requests within limit", async () => {
  const kv = await Deno.openKv(":memory:");
  const store = new KVRateLimitStore(kv);
  const { allowed } = await store.check("1.1.1.1", 3, 60_000);
  assert(allowed);
  kv.close();
});

Deno.test("KVRateLimitStore: check blocks at limit", async () => {
  const kv = await Deno.openKv(":memory:");
  const store = new KVRateLimitStore(kv);
  await store.check("ip-kv", 2, 60_000);
  await store.check("ip-kv", 2, 60_000);
  const { allowed } = await store.check("ip-kv", 2, 60_000);
  assertFalse(allowed);
  kv.close();
});

Deno.test("KVRateLimitStore: blocked check returns retryAfter > 0", async () => {
  const kv = await Deno.openKv(":memory:");
  const store = new KVRateLimitStore(kv);
  await store.check("ip-kv-retry", 1, 5_000);
  await store.check("ip-kv-retry", 1, 5_000);
  const { allowed, retryAfter } = await store.check("ip-kv-retry", 1, 5_000);
  assertFalse(allowed);
  assert(retryAfter >= 1);
  kv.close();
});

Deno.test("KVRateLimitStore: recordFailure accumulates count", async () => {
  const kv = await Deno.openKv(":memory:");
  const store = new KVRateLimitStore(kv);
  const c1 = await store.recordFailure("user-kv", 60_000);
  const c2 = await store.recordFailure("user-kv", 60_000);
  assertEquals(c1, 1);
  assertEquals(c2, 2);
  kv.close();
});

Deno.test("KVRateLimitStore: isLocked returns false below threshold", async () => {
  const kv = await Deno.openKv(":memory:");
  const store = new KVRateLimitStore(kv);
  await store.recordFailure("kv-u", 60_000);
  assertFalse(await store.isLocked("kv-u", 3, 60_000));
  kv.close();
});

Deno.test("KVRateLimitStore: isLocked returns true at threshold", async () => {
  const kv = await Deno.openKv(":memory:");
  const store = new KVRateLimitStore(kv);
  await store.recordFailure("kv-u2", 60_000);
  await store.recordFailure("kv-u2", 60_000);
  await store.recordFailure("kv-u2", 60_000);
  assert(await store.isLocked("kv-u2", 3, 60_000));
  kv.close();
});

Deno.test("KVRateLimitStore: clearFailures resets the counter", async () => {
  const kv = await Deno.openKv(":memory:");
  const store = new KVRateLimitStore(kv);
  await store.recordFailure("kv-u3", 60_000);
  await store.recordFailure("kv-u3", 60_000);
  await store.recordFailure("kv-u3", 60_000);
  await store.clearFailures("kv-u3");
  assertFalse(await store.isLocked("kv-u3", 3, 60_000));
  kv.close();
});

// Redis tests: Requires Redis — run manually with REDIS_URL set.
// import { RedisRateLimitStore } from "../../src/security/rate-limit-store.ts";
// To run: REDIS_URL=redis://localhost:6379 deno test -A tests/security/rate_limit_store_test.ts
