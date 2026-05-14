/**
 * Session store factory — select and construct the appropriate backend.
 *
 * Auto-detection order:
 *   1. DENO_DEPLOYMENT_ID env var present → "kv" (Deno Deploy)
 *   2. type === "redis" and redisUrl provided → "redis"
 *   3. type === "kv" → "kv"
 *   4. Default → "local" (file-backed, single-process safe)
 */

import type { StorageAdapter } from "../storage/types.ts";
import type { SessionStore } from "./types.ts";
import { createLocalSessionStore } from "./local.ts";
import { createKVSessionStore } from "./kv.ts";
import { createRedisSessionStoreFromUrl } from "./redis.ts";

export type { SessionStore } from "./types.ts";

export interface SessionStoreOptions {
  /** Explicit backend type. Auto-detected when omitted. */
  type?: "local" | "kv" | "redis";
  /** Redis connection URL. Required when type === "redis". */
  redisUrl?: string;
  /** StorageAdapter for the local backend. Required when type === "local". */
  storage?: StorageAdapter;
  /** Directory for session files (local backend). */
  sessionsDir?: string;
  /** Session lifetime in seconds. */
  lifetime: number;
}

/**
 * Construct a SessionStore for the resolved backend type.
 *
 * Throws if the resolved backend is "redis" but no `redisUrl` is provided,
 * or if the resolved backend is "local" but no `storage` adapter is provided.
 */
export async function createSessionStore(opts: SessionStoreOptions): Promise<SessionStore> {
  const resolved = resolveType(opts);

  if (resolved === "kv") {
    const kv = await Deno.openKv();
    return createKVSessionStore({ kv, lifetimeMs: opts.lifetime * 1000 });
  }

  if (resolved === "redis") {
    if (!opts.redisUrl) {
      throw new Error(
        "[dune] session_store.type is 'redis' but no redis URL was provided. " +
        "Set session_store.url in config or pass redisUrl to createSessionStore().",
      );
    }
    return createRedisSessionStoreFromUrl(opts.redisUrl, opts.lifetime);
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
    lifetime: opts.lifetime,
  });
}

function resolveType(opts: SessionStoreOptions): "local" | "kv" | "redis" {
  // Deno Deploy forces KV regardless of explicit config.
  if (Deno.env.get("DENO_DEPLOYMENT_ID")) return "kv";
  if (opts.type === "redis") return "redis";
  if (opts.type === "kv") return "kv";
  return "local";
}
