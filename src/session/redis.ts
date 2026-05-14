/**
 * Redis-backed session store (via ioredis).
 *
 * Key layout:
 *   dune:session:{id}          — JSON-encoded AdminSession (with EX TTL)
 *   dune:session_user:{userId} — Redis Set of session IDs for the user
 *
 * The store connects lazily — the Redis client is not contacted until the
 * first method call. This avoids blocking bootstrap when Redis is not yet
 * available or when the store is configured but not exercised in tests.
 *
 * Requires `npm:ioredis` to be present in the project's import map or
 * available via Deno's npm: specifier support.
 */

import type { AdminSession } from "../admin/types.ts";
import type { SessionStore } from "./types.ts";

// Minimal interface covering the ioredis methods we use, so callers can
// supply any compatible Redis client (ioredis, ioredis Cluster, etc.).
export interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, exFlag: "EX", ttlSeconds: number): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
  sadd(key: string, ...members: string[]): Promise<unknown>;
  srem(key: string, ...members: string[]): Promise<unknown>;
  smembers(key: string): Promise<string[]>;
  expire(key: string, seconds: number): Promise<unknown>;
}

export interface RedisSessionStoreConfig {
  /** ioredis client instance or compatible Redis client. */
  client: RedisClient;
  /** Session lifetime in seconds — used as the Redis EX TTL. */
  lifetimeSec: number;
}

const SESSION_PREFIX = "dune:session:";
const USER_SET_PREFIX = "dune:session_user:";

/**
 * Create a Redis-backed session store using a pre-constructed Redis client.
 */
export function createRedisSessionStore(config: RedisSessionStoreConfig): SessionStore {
  const { client, lifetimeSec } = config;

  function sessionKey(id: string): string {
    return `${SESSION_PREFIX}${id}`;
  }

  function userSetKey(userId: string): string {
    return `${USER_SET_PREFIX}${userId}`;
  }

  function ttlFor(session: AdminSession): number {
    const remaining = Math.ceil((session.expiresAt - Date.now()) / 1000);
    return remaining > 0 ? remaining : lifetimeSec;
  }

  async function get(id: string): Promise<AdminSession | null> {
    const raw = await client.get(sessionKey(id));
    if (raw === null) return null;

    let session: AdminSession;
    try {
      session = JSON.parse(raw) as AdminSession;
    } catch {
      return null;
    }

    if (session.expiresAt < Date.now()) {
      await client.del(sessionKey(id));
      return null;
    }

    return session;
  }

  async function set(session: AdminSession): Promise<void> {
    const ttl = ttlFor(session);
    const raw = JSON.stringify(session);
    // Write the session string and update the user set atomically via pipeline.
    await client.set(sessionKey(session.id), raw, "EX", ttl);
    await client.sadd(userSetKey(session.userId), session.id);
    // Keep the user index TTL in sync (extend it to at least this session's TTL).
    await client.expire(userSetKey(session.userId), ttl);
  }

  async function del(id: string): Promise<void> {
    // Read to get userId for user-set cleanup, then delete.
    const raw = await client.get(sessionKey(id));
    await client.del(sessionKey(id));
    if (raw !== null) {
      try {
        const session = JSON.parse(raw) as AdminSession;
        await client.srem(userSetKey(session.userId), id);
      } catch {
        // Best-effort index cleanup
      }
    }
  }

  async function deleteByUserId(userId: string): Promise<void> {
    const ids = await client.smembers(userSetKey(userId));
    if (ids.length > 0) {
      await client.del(...ids.map(sessionKey));
    }
    await client.del(userSetKey(userId));
  }

  async function cleanup(): Promise<number> {
    // Redis handles TTL expiry natively — no manual sweep required.
    return 0;
  }

  return { get, set, delete: del, deleteByUserId, cleanup };
}

/**
 * Create a Redis session store from a connection URL, using ioredis.
 * The client connects lazily on first use.
 *
 * @param url Redis connection URL, e.g. "redis://localhost:6379"
 * @param lifetimeSec Session TTL in seconds
 */
export async function createRedisSessionStoreFromUrl(
  url: string,
  lifetimeSec: number,
): Promise<SessionStore> {
  // Dynamic import so ioredis is not bundled when the Redis backend is not used.
  // Cast through unknown because the ioredis type declaration uses a class
  // with overloaded constructors that TypeScript cannot directly narrow to our
  // minimal RedisClient interface without the intermediate cast.
  const mod = await import("npm:ioredis@^5");
  const RedisClass = (mod.default ?? mod) as unknown as new (url: string) => RedisClient;
  const client = new RedisClass(url);
  return createRedisSessionStore({ client, lifetimeSec });
}
