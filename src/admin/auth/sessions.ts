/**
 * Session management — create, validate, and revoke admin sessions.
 *
 * Sessions are stored as JSON files in .dune/admin/sessions/ (gitignored).
 * This is ephemeral runtime state — losing sessions only means users must log in again.
 * Each session has a crypto-random ID used as the session cookie value.
 */

import { encodeHex } from "@std/encoding/hex";
import type { StorageAdapter } from "../../storage/types.ts";
import type { AdminSession } from "../types.ts";

export interface SessionManagerConfig {
  storage: StorageAdapter;
  /** Directory for session files (e.g. ".dune/admin/sessions") */
  sessionsDir: string;
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
 * Create a session manager backed by the storage adapter.
 */
export function createSessionManager(config: SessionManagerConfig): SessionManager {
  const { storage, sessionsDir, lifetime } = config;

  async function create(userId: string, ip?: string): Promise<AdminSession> {
    const id = await generateSessionId();
    const now = Date.now();

    const session: AdminSession = {
      id,
      userId,
      createdAt: now,
      expiresAt: now + (lifetime * 1000),
      ip,
    };

    const path = `${sessionsDir}/${id}.json`;
    const data = new TextEncoder().encode(JSON.stringify(session));
    await storage.write(path, data);

    return session;
  }

  async function get(sessionId: string): Promise<AdminSession | null> {
    const path = `${sessionsDir}/${sessionId}.json`;

    try {
      if (!(await storage.exists(path))) return null;

      const data = await storage.read(path);
      const session: AdminSession = JSON.parse(new TextDecoder().decode(data));

      // Check expiration
      if (session.expiresAt < Date.now()) {
        // Clean up expired session
        await storage.delete(path);
        return null;
      }

      return session;
    } catch {
      return null;
    }
  }

  async function revoke(sessionId: string): Promise<void> {
    const path = `${sessionsDir}/${sessionId}.json`;
    try {
      await storage.delete(path);
    } catch {
      // Already deleted — fine
    }
  }

  async function revokeAll(userId: string): Promise<void> {
    try {
      const entries = await storage.list(sessionsDir);
      for (const entry of entries) {
        if (entry.isDirectory || !entry.name.endsWith(".json")) continue;
        const path = `${sessionsDir}/${entry.name}`;
        try {
          const data = await storage.read(path);
          const session: AdminSession = JSON.parse(new TextDecoder().decode(data));
          if (session.userId === userId) {
            await storage.delete(path);
          }
        } catch {
          // Skip corrupt files
        }
      }
    } catch {
      // Sessions dir may not exist yet
    }
  }

  async function cleanup(): Promise<number> {
    let cleaned = 0;
    try {
      const entries = await storage.list(sessionsDir);
      const now = Date.now();

      for (const entry of entries) {
        if (entry.isDirectory || !entry.name.endsWith(".json")) continue;
        const path = `${sessionsDir}/${entry.name}`;
        try {
          const data = await storage.read(path);
          const session: AdminSession = JSON.parse(new TextDecoder().decode(data));
          if (session.expiresAt < now) {
            await storage.delete(path);
            cleaned++;
          }
        } catch {
          // Corrupt file — remove it
          await storage.delete(path);
          cleaned++;
        }
      }
    } catch {
      // Sessions dir doesn't exist
    }
    return cleaned;
  }

  return { create, get, revoke, revokeAll, cleanup };
}

async function generateSessionId(): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return encodeHex(bytes);
}
