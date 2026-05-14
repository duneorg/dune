/**
 * Tests for KVSessionStore (Deno KV-backed).
 *
 * Uses `Deno.openKv(":memory:")` so no external service is required.
 */

import {
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createKVSessionStore } from "../../src/session/kv.ts";
import type { AdminSession } from "../../src/admin/types.ts";

function makeSession(overrides: Partial<AdminSession> = {}): AdminSession {
  return {
    id: crypto.randomUUID().replace(/-/g, ""),
    userId: "user-1",
    createdAt: Date.now(),
    expiresAt: Date.now() + 3600 * 1000,
    ...overrides,
  };
}

// ── get / set ──────────────────────────────────────────────────────────────────

Deno.test("KVSessionStore: get returns null for missing session", async () => {
  const kv = await Deno.openKv(":memory:");
  const store = createKVSessionStore({ kv, lifetimeMs: 3600 * 1000 });
  assertEquals(await store.get("nonexistent"), null);
  kv.close();
});

Deno.test("KVSessionStore: set then get returns session", async () => {
  const kv = await Deno.openKv(":memory:");
  const store = createKVSessionStore({ kv, lifetimeMs: 3600 * 1000 });

  const session = makeSession();
  await store.set(session);
  const retrieved = await store.get(session.id);
  assertEquals(retrieved?.id, session.id);
  assertEquals(retrieved?.userId, session.userId);
  kv.close();
});

Deno.test("KVSessionStore: get returns null for logically expired session", async () => {
  const kv = await Deno.openKv(":memory:");
  const store = createKVSessionStore({ kv, lifetimeMs: 3600 * 1000 });

  // Manually write a session with a past expiresAt — the TTL check in get()
  // should catch it even if KV hasn't evicted the key yet.
  const session = makeSession({ expiresAt: Date.now() - 1 });
  await store.set(session);
  assertEquals(await store.get(session.id), null);
  kv.close();
});

// ── delete ─────────────────────────────────────────────────────────────────────

Deno.test("KVSessionStore: delete removes the session", async () => {
  const kv = await Deno.openKv(":memory:");
  const store = createKVSessionStore({ kv, lifetimeMs: 3600 * 1000 });

  const session = makeSession();
  await store.set(session);
  await store.delete(session.id);
  assertEquals(await store.get(session.id), null);
  kv.close();
});

Deno.test("KVSessionStore: delete is a no-op for missing session", async () => {
  const kv = await Deno.openKv(":memory:");
  const store = createKVSessionStore({ kv, lifetimeMs: 3600 * 1000 });
  await store.delete("does-not-exist");
  kv.close();
});

// ── deleteByUserId ─────────────────────────────────────────────────────────────

Deno.test("KVSessionStore: deleteByUserId removes all sessions for a user", async () => {
  const kv = await Deno.openKv(":memory:");
  const store = createKVSessionStore({ kv, lifetimeMs: 3600 * 1000 });

  const s1 = makeSession({ id: "s1aaaa", userId: "alice" });
  const s2 = makeSession({ id: "s2bbbb", userId: "alice" });
  const s3 = makeSession({ id: "s3cccc", userId: "bob" });

  await store.set(s1);
  await store.set(s2);
  await store.set(s3);

  await store.deleteByUserId("alice");

  assertEquals(await store.get(s1.id), null);
  assertEquals(await store.get(s2.id), null);
  assertNotEquals(await store.get(s3.id), null);
  kv.close();
});

Deno.test("KVSessionStore: deleteByUserId is safe when no sessions exist", async () => {
  const kv = await Deno.openKv(":memory:");
  const store = createKVSessionStore({ kv, lifetimeMs: 3600 * 1000 });
  await store.deleteByUserId("nobody");
  kv.close();
});

// ── cleanup ────────────────────────────────────────────────────────────────────

Deno.test("KVSessionStore: cleanup returns 0 (KV handles TTL natively)", async () => {
  const kv = await Deno.openKv(":memory:");
  const store = createKVSessionStore({ kv, lifetimeMs: 3600 * 1000 });
  const s = makeSession();
  await store.set(s);
  assertEquals(await store.cleanup(), 0);
  kv.close();
});
