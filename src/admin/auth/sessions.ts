/**
 * Session management — create, validate, and revoke admin sessions.
 *
 * The SessionManager wraps a SessionStore (file-backed, KV, or Redis) and
 * adds the session-creation logic (random ID generation, expiry calculation).
 * The public SessionManager interface is unchanged — all call sites continue
 * to work without modification.
 *
 * For the legacy single-process file-backed store, pass a LocalSessionStore
 * via the `store` option. When `storage` + `sessionsDir` are provided instead,
 * a LocalSessionStore is created automatically (backward-compatible path).
 */

import { encodeHex } from "@std/encoding/hex";
import type { StorageAdapter } from "../../storage/types.ts";
import type { AdminSession } from "../types.ts";
import type { SessionStore } from "../../session/types.ts";
import { createLocalSessionStore } from "../../session/local.ts";

export type { SessionStore };

export interface SessionManagerConfig {
  /**
   * Pre-constructed session store. When provided, `storage` and `sessionsDir`
   * are ignored.
   */
  store?: SessionStore;
  /**
   * StorageAdapter for the local (file-backed) store.
   * Required when `store` is not supplied.
   */
  storage?: StorageAdapter;
  /**
   * Directory for session files when using the local backend.
   * E.g. ".dune/admin/sessions"
   */
  sessionsDir?: string;
  /** Session lifetime in seconds */
  lifetime: number;
}

export interface SessionManager {
  /** Create a new session for a user */
  create(userId: string, ip?: string): Promise<AdminSession>;
  /** Get and validate a session by its ID. Returns null if expired or not found. */
  get(sessionId: string): Promise<AdminSession | null>;
  /** Revoke (delete) a session */
  revoke(sessionId: string): Promise<void>;
  /** Revoke all sessions for a user */
  revokeAll(userId: string): Promise<void>;
  /** Clean up expired sessions */
  cleanup(): Promise<number>;
}

/**
 * Create a session manager backed by the given store.
 *
 * When `config.store` is not supplied, falls back to constructing a
 * LocalSessionStore from `config.storage` + `config.sessionsDir`, preserving
 * the original file-backed behaviour for existing callers.
 */
export function createSessionManager(config: SessionManagerConfig): SessionManager {
  const { lifetime } = config;

  const store: SessionStore = config.store ?? (() => {
    if (!config.storage) {
      throw new Error(
        "[dune] createSessionManager: either 'store' or 'storage' must be provided.",
      );
    }
    return createLocalSessionStore({
      storage: config.storage,
      sessionsDir: config.sessionsDir ?? ".dune/admin/sessions",
      lifetime,
    });
  })();

  async function create(userId: string, ip?: string): Promise<AdminSession> {
    const id = await generateSessionId();
    const now = Date.now();

    const session: AdminSession = {
      id,
      userId,
      createdAt: now,
      expiresAt: now + lifetime * 1000,
      ip,
    };

    await store.set(session);
    return session;
  }

  async function get(sessionId: string): Promise<AdminSession | null> {
    return store.get(sessionId);
  }

  async function revoke(sessionId: string): Promise<void> {
    await store.delete(sessionId);
  }

  async function revokeAll(userId: string): Promise<void> {
    await store.deleteByUserId(userId);
  }

  async function cleanup(): Promise<number> {
    return store.cleanup();
  }

  return { create, get, revoke, revokeAll, cleanup };
}

async function generateSessionId(): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return encodeHex(bytes);
}
