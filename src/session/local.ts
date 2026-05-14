/**
 * Local (file-backed) session store.
 *
 * Stores each session as a JSON file under `sessionsDir` using the supplied
 * `StorageAdapter`. This is the default backend and preserves the exact
 * behaviour that existed before the store abstraction was introduced.
 *
 * Suitable for single-process deployments. When running behind a load
 * balancer or on Deno Deploy, use the KV or Redis backends instead.
 */

import type { StorageAdapter } from "../storage/types.ts";
import type { AdminSession } from "../admin/types.ts";
import type { SessionStore } from "./types.ts";

export interface LocalSessionStoreConfig {
  storage: StorageAdapter;
  /** Directory for session files, e.g. ".dune/admin/sessions" */
  sessionsDir: string;
  /** Session lifetime in seconds — used when writing new sessions */
  lifetime: number;
}

/**
 * Create a file-backed session store using the given StorageAdapter.
 */
export function createLocalSessionStore(config: LocalSessionStoreConfig): SessionStore {
  const { storage, sessionsDir } = config;

  async function get(id: string): Promise<AdminSession | null> {
    const path = `${sessionsDir}/${id}.json`;
    try {
      if (!(await storage.exists(path))) return null;

      const data = await storage.read(path);
      const session: AdminSession = JSON.parse(new TextDecoder().decode(data));

      if (session.expiresAt < Date.now()) {
        await storage.delete(path);
        return null;
      }

      return session;
    } catch {
      return null;
    }
  }

  async function set(session: AdminSession): Promise<void> {
    const path = `${sessionsDir}/${session.id}.json`;
    const data = new TextEncoder().encode(JSON.stringify(session));
    await storage.write(path, data);
  }

  async function del(id: string): Promise<void> {
    const path = `${sessionsDir}/${id}.json`;
    try {
      await storage.delete(path);
    } catch {
      // Already deleted — fine
    }
  }

  async function deleteByUserId(userId: string): Promise<void> {
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

  return { get, set, delete: del, deleteByUserId, cleanup };
}
