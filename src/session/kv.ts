/**
 * Deno KV-backed session store.
 *
 * Sessions are keyed by `sKey(id)` (`[prefix, "sessions", id]` with a prefix) with a TTL so Deno KV handles
 * expiry natively. A secondary index at `["sessions_by_user", userId, id]`
 * (also with TTL) supports efficient deleteByUserId without a full scan.
 *
 * This backend is selected automatically when `DENO_DEPLOYMENT_ID` is set
 * (i.e. running on Deno Deploy) or when explicitly requested via config.
 */

import type { Session } from "./types.ts";
import type { SessionStore } from "./types.ts";

export interface KVSessionStoreConfig {
  /** Deno KV instance. Pass `await Deno.openKv()` or a test instance. */
  kv: Deno.Kv;
  /** Session lifetime in milliseconds (used as the KV TTL). */
  lifetimeMs: number;
  /**
   * Key namespace, prepended to every key. Omit for the original keys. Sites
   * sharing one KV database (multisite in one process) need distinct prefixes.
   */
  prefix?: string;
}

/**
 * Create a Deno KV-backed session store.
 */
export function createKVSessionStore(config: KVSessionStoreConfig): SessionStore {
  const { kv, lifetimeMs } = config;
  const ns: string[] = config.prefix ? [config.prefix] : [];
  const sKey = (id: string): Deno.KvKey => [...ns, "sessions", id];
  const uKey = (userId: string, id?: string): Deno.KvKey =>
    id === undefined
      ? [...ns, "sessions_by_user", userId]
      : [...ns, "sessions_by_user", userId, id];

  async function get(id: string): Promise<Session | null> {
    const result = await kv.get<Session>(sKey(id));
    if (result.value === null) return null;

    // Belt-and-suspenders expiry check in case TTL is not enforced yet.
    if (result.value.expiresAt < Date.now()) {
      await kv.delete(sKey(id));
      return null;
    }

    return result.value;
  }

  async function set(session: Session): Promise<void> {
    const ttlMs = Math.max(0, session.expiresAt - Date.now());
    // Write the session data and the user index entry atomically.
    await kv.atomic()
      .set(sKey(session.id), session, { expireIn: ttlMs || lifetimeMs })
      .set(uKey(session.userId, session.id), true, { expireIn: ttlMs || lifetimeMs })
      .commit();
  }

  async function del(id: string): Promise<void> {
    // Retrieve to get userId for index cleanup, then delete both entries.
    const result = await kv.get<Session>(sKey(id));
    if (result.value !== null) {
      await kv.atomic()
        .delete(sKey(id))
        .delete(uKey(result.value.userId, id))
        .commit();
    } else {
      await kv.delete(sKey(id));
    }
  }

  async function deleteByUserId(userId: string): Promise<void> {
    // List all entries in the user index prefix and delete each.
    const iter = kv.list<boolean>({ prefix: uKey(userId) });
    const ops = kv.atomic();
    const sessionIds: string[] = [];

    for await (const entry of iter) {
      const sessionId = entry.key[entry.key.length - 1] as string;
      sessionIds.push(sessionId);
      ops.delete(uKey(userId, sessionId));
    }

    for (const sid of sessionIds) {
      ops.delete(sKey(sid));
    }

    await ops.commit();
  }

  async function listByUserId(userId: string): Promise<Session[]> {
    const out: Session[] = [];
    for await (const entry of kv.list<boolean>({ prefix: uKey(userId) })) {
      const sessionId = entry.key[entry.key.length - 1] as string;
      const result = await kv.get<Session>(sKey(sessionId));
      if (result.value !== null) out.push(result.value);
    }
    return out;
  }

  async function cleanup(): Promise<number> {
    // Deno KV handles TTL expiry natively — no manual sweep required.
    return 0;
  }

  return { get, set, delete: del, deleteByUserId, listByUserId, cleanup };
}
