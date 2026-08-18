/**
 * Tests for createRedisSessionStore() (the Redis-backed SessionStore).
 *
 * Exercised against a small in-memory fake implementing RedisClient
 * (GET/SET EX/DEL/SADD/SREM/SMEMBERS/EXPIRE) rather than a live Redis
 * server — the store's own logic (key layout, user-set bookkeeping, TTL
 * handling) is what's under test here, not ioredis itself.
 *
 * No prior coverage existed for this store at all before this file.
 */

import {
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createRedisSessionStore } from "../../src/session/redis.ts";
import type { RedisClient } from "../../src/session/redis.ts";
import type { Session } from "../../src/session/types.ts";

/** Minimal in-memory fake of the RedisClient interface used by the store. */
class FakeRedisClient implements RedisClient {
  strings = new Map<string, string>();
  sets = new Map<string, Set<string>>();
  ttls = new Map<string, number>(); // key -> expiry epoch ms, for inspection only

  async get(key: string): Promise<string | null> {
    return this.strings.get(key) ?? null;
  }

  async set(
    key: string,
    value: string,
    exFlag: "EX",
    ttlSeconds: number,
  ): Promise<unknown> {
    this.strings.set(key, value);
    this.ttls.set(key, Date.now() + ttlSeconds * 1000);
    return "OK";
  }

  async del(...keys: string[]): Promise<unknown> {
    let count = 0;
    for (const key of keys) {
      if (this.strings.delete(key)) count++;
      if (this.sets.delete(key)) count++;
      this.ttls.delete(key);
    }
    return count;
  }

  async sadd(key: string, ...members: string[]): Promise<unknown> {
    const set = this.sets.get(key) ?? new Set<string>();
    for (const m of members) set.add(m);
    this.sets.set(key, set);
    return members.length;
  }

  async srem(key: string, ...members: string[]): Promise<unknown> {
    const set = this.sets.get(key);
    if (!set) return 0;
    let count = 0;
    for (const m of members) if (set.delete(m)) count++;
    return count;
  }

  async smembers(key: string): Promise<string[]> {
    return Array.from(this.sets.get(key) ?? []);
  }

  async expire(key: string, seconds: number): Promise<unknown> {
    this.ttls.set(key, Date.now() + seconds * 1000);
    return 1;
  }
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: crypto.randomUUID().replace(/-/g, ""),
    userId: "user-1",
    createdAt: Date.now(),
    expiresAt: Date.now() + 3600 * 1000,
    ...overrides,
  };
}

// ── get / set ──────────────────────────────────────────────────────────────────

Deno.test("RedisSessionStore: get returns null for missing session", async () => {
  const store = createRedisSessionStore({
    client: new FakeRedisClient(),
    lifetimeSec: 3600,
  });
  assertEquals(await store.get("nonexistent"), null);
});

Deno.test("RedisSessionStore: set then get returns session", async () => {
  const store = createRedisSessionStore({
    client: new FakeRedisClient(),
    lifetimeSec: 3600,
  });

  const session = makeSession();
  await store.set(session);
  const retrieved = await store.get(session.id);
  assertEquals(retrieved?.id, session.id);
  assertEquals(retrieved?.userId, session.userId);
});

Deno.test("RedisSessionStore: set writes under the dune:session: key prefix", async () => {
  const client = new FakeRedisClient();
  const store = createRedisSessionStore({ client, lifetimeSec: 3600 });

  const session = makeSession();
  await store.set(session);
  assertEquals(client.strings.has(`dune:session:${session.id}`), true);
});

Deno.test("RedisSessionStore: get returns null for logically expired session and deletes it", async () => {
  const client = new FakeRedisClient();
  const store = createRedisSessionStore({ client, lifetimeSec: 3600 });

  // Manually write a session with a past expiresAt — the TTL check in get()
  // should catch it even if the fake hasn't evicted the key (fake has no
  // real TTL eviction, matching how a real EX-expired key would already be
  // gone, but also covering the case where JSON's expiresAt is what's stale).
  const session = makeSession({ expiresAt: Date.now() - 1 });
  await store.set(session);
  assertEquals(await store.get(session.id), null);
  assertEquals(client.strings.has(`dune:session:${session.id}`), false);
});

Deno.test("RedisSessionStore: get returns null for malformed JSON", async () => {
  const client = new FakeRedisClient();
  const store = createRedisSessionStore({ client, lifetimeSec: 3600 });

  client.strings.set("dune:session:broken", "{not json");
  assertEquals(await store.get("broken"), null);
});

Deno.test("RedisSessionStore: set adds the session id to the user's set", async () => {
  const client = new FakeRedisClient();
  const store = createRedisSessionStore({ client, lifetimeSec: 3600 });

  const session = makeSession({ userId: "alice" });
  await store.set(session);
  assertEquals(
    client.sets.get("dune:session_user:alice")?.has(session.id),
    true,
  );
});

Deno.test("RedisSessionStore: set uses the session's remaining TTL, not the default lifetime", async () => {
  const client = new FakeRedisClient();
  const store = createRedisSessionStore({ client, lifetimeSec: 3600 });

  const session = makeSession({ expiresAt: Date.now() + 60 * 1000 }); // 60s left
  await store.set(session);
  const ttl = client.ttls.get(`dune:session:${session.id}`)!;
  const remainingSec = (ttl - Date.now()) / 1000;
  // Should be ~60s, not the 3600s default lifetime.
  assertEquals(remainingSec < 120, true);
});

Deno.test("RedisSessionStore: set falls back to the default lifetime when already expired", async () => {
  const client = new FakeRedisClient();
  const store = createRedisSessionStore({ client, lifetimeSec: 3600 });

  const session = makeSession({ expiresAt: Date.now() - 1000 });
  await store.set(session);
  const ttl = client.ttls.get(`dune:session:${session.id}`)!;
  const remainingSec = (ttl - Date.now()) / 1000;
  assertEquals(remainingSec > 3000, true);
});

// ── delete ─────────────────────────────────────────────────────────────────────

Deno.test("RedisSessionStore: delete removes the session", async () => {
  const store = createRedisSessionStore({
    client: new FakeRedisClient(),
    lifetimeSec: 3600,
  });

  const session = makeSession();
  await store.set(session);
  await store.delete(session.id);
  assertEquals(await store.get(session.id), null);
});

Deno.test("RedisSessionStore: delete removes the session id from the user's set", async () => {
  const client = new FakeRedisClient();
  const store = createRedisSessionStore({ client, lifetimeSec: 3600 });

  const session = makeSession({ userId: "alice" });
  await store.set(session);
  await store.delete(session.id);
  assertEquals(
    client.sets.get("dune:session_user:alice")?.has(session.id),
    false,
  );
});

Deno.test("RedisSessionStore: delete is a no-op for missing session", async () => {
  const store = createRedisSessionStore({
    client: new FakeRedisClient(),
    lifetimeSec: 3600,
  });
  await store.delete("does-not-exist");
});

// ── deleteByUserId ─────────────────────────────────────────────────────────────

Deno.test("RedisSessionStore: deleteByUserId removes all sessions for a user", async () => {
  const store = createRedisSessionStore({
    client: new FakeRedisClient(),
    lifetimeSec: 3600,
  });

  const s1 = makeSession({ userId: "alice" });
  const s2 = makeSession({ userId: "alice" });
  const s3 = makeSession({ userId: "bob" });

  await store.set(s1);
  await store.set(s2);
  await store.set(s3);

  await store.deleteByUserId("alice");

  assertEquals(await store.get(s1.id), null);
  assertEquals(await store.get(s2.id), null);
  assertNotEquals(await store.get(s3.id), null);
});

Deno.test("RedisSessionStore: deleteByUserId also clears the user's set key", async () => {
  const client = new FakeRedisClient();
  const store = createRedisSessionStore({ client, lifetimeSec: 3600 });

  const session = makeSession({ userId: "alice" });
  await store.set(session);
  await store.deleteByUserId("alice");
  assertEquals(client.sets.has("dune:session_user:alice"), false);
});

Deno.test("RedisSessionStore: deleteByUserId is safe when no sessions exist", async () => {
  const store = createRedisSessionStore({
    client: new FakeRedisClient(),
    lifetimeSec: 3600,
  });
  await store.deleteByUserId("nobody");
});

// ── cleanup ────────────────────────────────────────────────────────────────────

Deno.test("RedisSessionStore: cleanup returns 0 (Redis handles TTL natively)", async () => {
  const store = createRedisSessionStore({
    client: new FakeRedisClient(),
    lifetimeSec: 3600,
  });
  const s = makeSession();
  await store.set(s);
  assertEquals(await store.cleanup(), 0);
});
