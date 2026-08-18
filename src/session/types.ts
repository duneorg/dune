/**
 * Session data stored in the session backend — shared by the admin panel
 * (@dune/plugin-admin) and public site auth (mountDuneAuth()) per
 * decisions/dec-identity-unification.md's Phase 5c. Defined here (in core)
 * so that session store implementations do not depend on the admin plugin
 * package.
 */

import type { User } from "../auth/types.ts";

export interface Session {
  id: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
  /** IP address of the client that created the session */
  ip?: string;
  /**
   * Full user object embedded in the session. Set when the caller has no
   * persistent user record to look up from — public auth's
   * `userStore: "session"` mode synthesises a User from OAuth/magic-link
   * claims at login and carries it in the session for the cookie's
   * lifetime. Admin sessions never set this.
   */
  embeddedUser?: User;
}

/**
 * Session store interface — backend-agnostic contract for session persistence.
 *
 * Implementations must be safe for concurrent access (multiple processes or
 * Deno isolates hitting the same backing store). The local file-backed store is
 * sufficient for single-process deployments; use the KV or Redis backends when
 * running behind a load balancer or on Deno Deploy.
 */
export interface SessionStore {
  /** Retrieve a session by ID. Returns null if not found or expired. */
  get(id: string): Promise<Session | null>;

  /** Persist a session. Overwrites any existing entry with the same ID. */
  set(session: Session): Promise<void>;

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
