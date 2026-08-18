/**
 * Tests for createSessionManager() — the shared session mechanism used by
 * both @dune/plugin-admin's admin sessions and public-site auth sessions
 * (dec-identity-unification Phase 5c). Exercised over the local backend;
 * the manager itself is backend-agnostic (works over any SessionStore).
 */

import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createLocalSessionStore } from "../../src/session/local.ts";
import { createSessionManager } from "../../src/session/mod.ts";
import type { User } from "../../src/auth/types.ts";

function createMemoryStorage() {
  const files = new Map<string, Uint8Array>();
  return {
    async read(path: string): Promise<Uint8Array> {
      const d = files.get(path);
      if (!d) throw new Error(`Not found: ${path}`);
      return d;
    },
    async write(path: string, data: Uint8Array | string): Promise<void> {
      const bytes = typeof data === "string"
        ? new TextEncoder().encode(data)
        : data;
      files.set(path, bytes);
    },
    async exists(path: string): Promise<boolean> {
      return files.has(path);
    },
    async delete(path: string): Promise<void> {
      files.delete(path);
    },
    async list(
      dir: string,
    ): Promise<
      { name: string; isDirectory: boolean; path: string; isFile: boolean }[]
    > {
      const prefix = dir.endsWith("/") ? dir : `${dir}/`;
      const result: {
        name: string;
        isDirectory: boolean;
        path: string;
        isFile: boolean;
      }[] = [];
      for (const key of files.keys()) {
        if (key.startsWith(prefix)) {
          const rest = key.slice(prefix.length);
          if (!rest.includes("/")) {
            result.push({
              name: rest,
              isDirectory: false,
              path: key,
              isFile: true,
            });
          }
        }
      }
      return result;
    },
    // deno-lint-ignore no-explicit-any
  } as any;
}

function makeManager(lifetimeMs = 3600_000) {
  const storage = createMemoryStorage();
  const store = createLocalSessionStore({
    storage,
    sessionsDir: "sessions",
    lifetimeMs,
  });
  return createSessionManager(store, lifetimeMs);
}

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "u1",
    email: "u1@example.com",
    provider: "magic",
    roles: ["member"],
    createdAt: 0,
    updatedAt: 0,
    lastSeenAt: 0,
    enabled: true,
    ...overrides,
  };
}

Deno.test("createSessionManager: create returns a session with a generated id and expiry", async () => {
  const mgr = makeManager();
  const session = await mgr.create("user-1", "1.2.3.4");

  assertExists(session.id);
  assertEquals(session.id.length, 64); // 32 bytes hex
  assertEquals(session.userId, "user-1");
  assertEquals(session.ip, "1.2.3.4");
  assertEquals(session.embeddedUser, undefined);
  assertEquals(session.expiresAt > session.createdAt, true);
});

Deno.test("createSessionManager: get retrieves a created session", async () => {
  const mgr = makeManager();
  const created = await mgr.create("user-1");

  const found = await mgr.get(created.id);
  assertEquals(found?.id, created.id);
  assertEquals(found?.userId, "user-1");
});

Deno.test("createSessionManager: get returns null for a missing session", async () => {
  const mgr = makeManager();
  assertEquals(await mgr.get("nonexistent"), null);
});

Deno.test("createSessionManager: revoke deletes a session", async () => {
  const mgr = makeManager();
  const created = await mgr.create("user-1");

  await mgr.revoke(created.id);
  assertEquals(await mgr.get(created.id), null);
});

Deno.test("createSessionManager: revokeAll deletes every session for a user, leaves others", async () => {
  const mgr = makeManager();
  const a1 = await mgr.create("user-a");
  const a2 = await mgr.create("user-a");
  const b1 = await mgr.create("user-b");

  await mgr.revokeAll("user-a");

  assertEquals(await mgr.get(a1.id), null);
  assertEquals(await mgr.get(a2.id), null);
  assertExists(await mgr.get(b1.id));
});

Deno.test("createSessionManager: cleanup removes expired sessions", async () => {
  const mgr = makeManager(-1000); // already expired
  await mgr.create("user-1");

  const cleaned = await mgr.cleanup();
  assertEquals(cleaned >= 1, true);
});

// === embeddedUser — public auth's userStore: "session" mode ===

Deno.test("createSessionManager: create with embeddedUser round-trips it through get", async () => {
  const mgr = makeManager();
  const user = makeUser({ id: "synthetic-1", email: "synth@example.com" });

  const created = await mgr.create("synthetic-1", undefined, user);
  assertEquals(created.embeddedUser?.id, "synthetic-1");

  const found = await mgr.get(created.id);
  assertEquals(found?.embeddedUser?.email, "synth@example.com");
  assertEquals(found?.embeddedUser?.roles, ["member"]);
});

Deno.test("createSessionManager: create without embeddedUser omits the field entirely (not undefined-valued)", async () => {
  const mgr = makeManager();
  const created = await mgr.create("user-1");

  assertEquals("embeddedUser" in created, false);
});

Deno.test("createSessionManager: admin-style callers never pass embeddedUser and it stays absent", async () => {
  // Mirrors how @dune/plugin-admin's sessions.ts calls create() — no third arg.
  const mgr = makeManager();
  const session = await mgr.create("admin-1", "10.0.0.1");

  assertEquals(session.embeddedUser, undefined);
  const found = await mgr.get(session.id);
  assertEquals(found?.embeddedUser, undefined);
});
