/**
 * Session store factory — select and construct the appropriate backend.
 *
 * Auto-detection order:
 *   1. DENO_DEPLOYMENT_ID env var present → "kv" (Deno Deploy)
 *   2. type === "redis" and redisUrl provided → "redis"
 *   3. type === "kv" → "kv"
 *   4. Default → "local" (file-backed, single-process safe)
 *
 * @module
 */

import { encodeHex } from "@std/encoding/hex";
import type { StorageAdapter } from "../storage/types.ts";
import type { Session, SessionStore } from "./types.ts";
import type { User } from "../auth/types.ts";
import { createLocalSessionStore } from "./local.ts";
import { createKVSessionStore } from "./kv.ts";
import { createRedisSessionStoreFromUrl } from "./redis.ts";

export type {
  /** Session store interface — backend-agnostic contract for session persistence. */
  SessionStore,
} from "./types.ts";

/** Options for {@link createSessionStore}. */
export interface SessionStoreOptions {
  /** Explicit backend type. Auto-detected when omitted. */
  type?: "local" | "kv" | "redis";
  /** Redis connection URL. Required when type === "redis". */
  redisUrl?: string;
  /** StorageAdapter for the local backend. Required when type === "local". */
  storage?: StorageAdapter;
  /** Directory for session files (local backend). */
  sessionsDir?: string;
  /** Session lifetime in milliseconds. */
  lifetimeMs: number;
}

/**
 * Construct a SessionStore for the resolved backend type.
 *
 * Throws if the resolved backend is "redis" but no `redisUrl` is provided,
 * or if the resolved backend is "local" but no `storage` adapter is provided.
 */
export async function createSessionStore(opts: SessionStoreOptions): Promise<SessionStore> {
  const resolvedLifetimeMs = opts.lifetimeMs;
  const resolved = resolveType(opts);

  if (resolved === "kv") {
    const kv = await Deno.openKv();
    return createKVSessionStore({ kv, lifetimeMs: resolvedLifetimeMs });
  }

  if (resolved === "redis") {
    if (!opts.redisUrl) {
      throw new Error(
        "[dune] session_store.type is 'redis' but no redis URL was provided. " +
        "Set session_store.url in config or pass redisUrl to createSessionStore().",
      );
    }
    return createRedisSessionStoreFromUrl(opts.redisUrl, resolvedLifetimeMs / 1000);
  }

  // local
  if (!opts.storage) {
    throw new Error(
      "[dune] createSessionStore: 'storage' adapter is required for the local backend.",
    );
  }
  return createLocalSessionStore({
    storage: opts.storage,
    sessionsDir: opts.sessionsDir ?? ".dune/admin/sessions",
    lifetimeMs: resolvedLifetimeMs,
  });
}

function resolveType(opts: SessionStoreOptions): "local" | "kv" | "redis" {
  // Deno Deploy forces KV regardless of explicit config.
  if (Deno.env.get("DENO_DEPLOYMENT_ID")) return "kv";
  if (opts.type === "redis") return "redis";
  if (opts.type === "kv") return "kv";
  return "local";
}

/**
 * Creates and validates sessions backed by a SessionStore.
 *
 * Shared by @dune/plugin-admin's admin sessions and public-site auth
 * sessions (dec-identity-unification Phase 5c) — one mechanism,
 * parameterized by which SessionStore backend it's given, rather than two
 * independently-implemented stacks. `create()`'s `embeddedUser` param is
 * only ever used by public auth's `userStore: "session"` mode; admin
 * sessions never pass it.
 */
export interface SessionManager {
  /** Create a new session for a user. */
  create(userId: string, ip?: string, embeddedUser?: User): Promise<Session>;
  /** Get and validate a session by its ID. Returns null if expired or not found. */
  get(sessionId: string): Promise<Session | null>;
  /** Revoke (delete) a session. */
  revoke(sessionId: string): Promise<void>;
  /** Revoke all sessions for a user. */
  revokeAll(userId: string): Promise<void>;
  /** Clean up expired sessions. */
  cleanup(): Promise<number>;
}

/** Create a SessionManager over the given store. `lifetimeMs` determines each session's `expiresAt`. */
export function createSessionManager(store: SessionStore, lifetimeMs: number): SessionManager {
  async function create(userId: string, ip?: string, embeddedUser?: User): Promise<Session> {
    const id = await generateSessionId();
    const now = Date.now();
    const session: Session = {
      id,
      userId,
      createdAt: now,
      expiresAt: now + lifetimeMs,
      ip,
      ...(embeddedUser !== undefined ? { embeddedUser } : {}),
    };
    await store.set(session);
    return session;
  }

  async function get(sessionId: string): Promise<Session | null> {
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

// Re-export low-level session primitives for @dune/plugin-admin
export { createLocalSessionStore } from "./local.ts";
export type { Session } from "./types.ts";
