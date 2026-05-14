/**
 * Session store interface — backend-agnostic contract for admin session persistence.
 *
 * Implementations must be safe for concurrent access (multiple processes or
 * Deno isolates hitting the same backing store). The local file-backed store is
 * sufficient for single-process deployments; use the KV or Redis backends when
 * running behind a load balancer or on Deno Deploy.
 */

import type { AdminSession } from "../admin/types.ts";

export interface SessionStore {
  /** Retrieve a session by ID. Returns null if not found or expired. */
  get(id: string): Promise<AdminSession | null>;

  /** Persist a session. Overwrites any existing entry with the same ID. */
  set(session: AdminSession): Promise<void>;

  /** Delete a single session by ID. No-op if not found. */
  delete(id: string): Promise<void>;

  /**
   * Delete all sessions belonging to a user.
   * Used on password change, explicit "sign out everywhere", and login
   * (to ensure only one active session per user).
   */
  deleteByUserId(userId: string): Promise<void>;

  /**
   * Remove expired sessions from the store and return the count deleted.
   * Backends that handle TTL natively (KV, Redis) should return 0 immediately —
   * the runtime will expire entries on read without a sweep being required.
   */
  cleanup(): Promise<number>;
}
