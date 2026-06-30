/**
 * Deno KV-backed session store.
 *
 * Sessions are keyed by `["sessions", id]` with a TTL so Deno KV handles
 * expiry natively. A secondary index at `["sessions_by_user", userId, id]`
 * (also with TTL) supports efficient deleteByUserId without a full scan.
 *
 * This backend is selected automatically when `DENO_DEPLOYMENT_ID` is set
 * (i.e. running on Deno Deploy) or when explicitly requested via config.
 */

import type { AdminSession } from "./types.ts";
import type { SessionStore } from "./types.ts";

export interface KVSessionStoreConfig {
  /** Deno KV instance. Pass `await Deno.openKv()` or a test instance. */
  kv: Deno.Kv;
  /** Session lifetime in milliseconds (used as the KV TTL). */
  lifetimeMs: number;
}

/**
 * Create a Deno KV-backed session store.
 */
export function createKVSessionStore(config: KVSessionStoreConfig): SessionStore {
  const { kv, lifetimeMs } = config;

  async function get(id: string): Promise<AdminSession | null> {
    const result = await kv.get<AdminSession>(["sessions", id]);
    if (result.value === null) return null;

    // Belt-and-suspenders expiry check in case TTL is not enforced yet.
    if (result.value.expiresAt < Date.now()) {
      await kv.delete(["sessions", id]);
      return null;
    }

    return result.value;
  }

  async function set(session: AdminSession): Promise<void> {
    const ttlMs = Math.max(0, session.expiresAt - Date.now());
    // Write the session data and the user index entry atomically.
    await kv.atomic()
      .set(["sessions", session.id], session, { expireIn: ttlMs || lifetimeMs })
      .set(["sessions_by_user", session.userId, session.id], true, { expireIn: ttlMs || lifetimeMs })
      .commit();
  }

  async function del(id: string): Promise<void> {
    // Retrieve to get userId for index cleanup, then delete both entries.
    const result = await kv.get<AdminSession>(["sessions", id]);
    if (result.value !== null) {
      await kv.atomic()
        .delete(["sessions", id])
        .delete(["sessions_by_user", result.value.userId, id])
        .commit();
    } else {
      await kv.delete(["sessions", id]);
    }
  }

  async function deleteByUserId(userId: string): Promise<void> {
    // List all entries in the user index prefix and delete each.
    const iter = kv.list<boolean>({ prefix: ["sessions_by_user", userId] });
    const ops = kv.atomic();
    const sessionIds: string[] = [];

    for await (const entry of iter) {
      const sessionId = entry.key[2] as string;
      sessionIds.push(sessionId);
      ops.delete(["sessions_by_user", userId, sessionId]);
    }

    for (const sid of sessionIds) {
      ops.delete(["sessions", sid]);
    }

    await ops.commit();
  }

  async function cleanup(): Promise<number> {
    // Deno KV handles TTL expiry natively — no manual sweep required.
    return 0;
  }

  return { get, set, delete: del, deleteByUserId, cleanup };
}
