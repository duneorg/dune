/**
 * Tests for LocalSessionStore (file-backed, single-process).
 */

import {
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createLocalSessionStore } from "../../src/session/local.ts";
import type { AdminSession } from "../../src/admin/types.ts";

// Minimal in-memory StorageAdapter sufficient for session store tests.
function createMemoryStorage() {
  const files = new Map<string, Uint8Array>();
  return {
    async read(path: string): Promise<Uint8Array> {
      const d = files.get(path);
      if (!d) throw new Error(`Not found: ${path}`);
      return d;
    },
    async write(path: string, data: Uint8Array | string): Promise<void> {
      const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
      files.set(path, bytes);
    },
    async exists(path: string): Promise<boolean> {
      return files.has(path);
    },
    async delete(path: string): Promise<void> {
      files.delete(path);
    },
    async list(dir: string): Promise<{ name: string; isDirectory: boolean; path: string; isFile: boolean }[]> {
      const prefix = dir.endsWith("/") ? dir : `${dir}/`;
      const result: { name: string; isDirectory: boolean; path: string; isFile: boolean }[] = [];
      for (const key of files.keys()) {
        if (key.startsWith(prefix)) {
          const rest = key.slice(prefix.length);
          if (!rest.includes("/")) {
            result.push({ name: rest, isDirectory: false, path: key, isFile: true });
          }
        }
      }
      return result;
    },
  } as any;
}

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

Deno.test("LocalSessionStore: get returns null for missing session", async () => {
  const store = createLocalSessionStore({ storage: createMemoryStorage(), sessionsDir: ".sess", lifetime: 3600 });
  assertEquals(await store.get("nonexistent"), null);
});

Deno.test("LocalSessionStore: set then get returns session", async () => {
  const store = createLocalSessionStore({ storage: createMemoryStorage(), sessionsDir: ".sess", lifetime: 3600 });
  const session = makeSession();
  await store.set(session);
  const retrieved = await store.get(session.id);
  assertEquals(retrieved?.id, session.id);
  assertEquals(retrieved?.userId, session.userId);
});

Deno.test("LocalSessionStore: get returns null for expired session", async () => {
  const store = createLocalSessionStore({ storage: createMemoryStorage(), sessionsDir: ".sess", lifetime: 1 });
  const session = makeSession({ expiresAt: Date.now() - 1 }); // already expired
  await store.set(session);
  assertEquals(await store.get(session.id), null);
});

// ── delete ─────────────────────────────────────────────────────────────────────

Deno.test("LocalSessionStore: delete removes the session", async () => {
  const store = createLocalSessionStore({ storage: createMemoryStorage(), sessionsDir: ".sess", lifetime: 3600 });
  const session = makeSession();
  await store.set(session);
  await store.delete(session.id);
  assertEquals(await store.get(session.id), null);
});

Deno.test("LocalSessionStore: delete is a no-op for missing session", async () => {
  const store = createLocalSessionStore({ storage: createMemoryStorage(), sessionsDir: ".sess", lifetime: 3600 });
  // Should not throw
  await store.delete("does-not-exist");
});

// ── deleteByUserId ─────────────────────────────────────────────────────────────

Deno.test("LocalSessionStore: deleteByUserId removes all sessions for a user", async () => {
  const store = createLocalSessionStore({ storage: createMemoryStorage(), sessionsDir: ".sess", lifetime: 3600 });

  const s1 = makeSession({ id: "aaaa", userId: "alice" });
  const s2 = makeSession({ id: "bbbb", userId: "alice" });
  const s3 = makeSession({ id: "cccc", userId: "bob" });

  await store.set(s1);
  await store.set(s2);
  await store.set(s3);

  await store.deleteByUserId("alice");

  assertEquals(await store.get(s1.id), null);
  assertEquals(await store.get(s2.id), null);
  assertNotEquals(await store.get(s3.id), null); // bob's session untouched
});

Deno.test("LocalSessionStore: deleteByUserId is safe when no sessions exist", async () => {
  const store = createLocalSessionStore({ storage: createMemoryStorage(), sessionsDir: ".sess", lifetime: 3600 });
  await store.deleteByUserId("nobody");
});

// ── cleanup ────────────────────────────────────────────────────────────────────

Deno.test("LocalSessionStore: cleanup removes only expired sessions", async () => {
  const store = createLocalSessionStore({ storage: createMemoryStorage(), sessionsDir: ".sess", lifetime: 3600 });

  const active = makeSession({ id: "live", expiresAt: Date.now() + 3600 * 1000 });
  const expired = makeSession({ id: "dead", expiresAt: Date.now() - 1 });

  await store.set(active);
  await store.set(expired);

  const count = await store.cleanup();
  assertEquals(count, 1);
  assertNotEquals(await store.get(active.id), null);
  assertEquals(await store.get(expired.id), null);
});

Deno.test("LocalSessionStore: cleanup returns 0 when nothing is expired", async () => {
  const store = createLocalSessionStore({ storage: createMemoryStorage(), sessionsDir: ".sess", lifetime: 3600 });
  const s = makeSession();
  await store.set(s);
  assertEquals(await store.cleanup(), 0);
});
