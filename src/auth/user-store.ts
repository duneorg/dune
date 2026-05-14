/**
 * Site user store — CRUD operations for public site user accounts.
 *
 * Users are stored as JSON files in data/site-users/{id}.json.
 * An email index at data/site-users/by-email/{encodedEmail}.json contains
 * just { id } for O(1) email lookup without scanning all user files.
 */

import { encodeHex } from "@std/encoding/hex";
import type { StorageAdapter } from "../storage/types.ts";
import type { SiteUser, SiteUserCreate } from "./types.ts";

export interface SiteUserStore {
  getById(id: string): Promise<SiteUser | null>;
  getByEmail(email: string): Promise<SiteUser | null>;
  getByProvider(provider: string, providerId: string): Promise<SiteUser | null>;
  create(user: SiteUserCreate): Promise<SiteUser>;
  update(
    id: string,
    updates: Partial<Pick<SiteUser, "name" | "avatarUrl" | "roles" | "lastSeenAt" | "enabled">>,
  ): Promise<SiteUser | null>;
  list(opts?: { limit?: number; offset?: number }): Promise<SiteUser[]>;
  delete(id: string): Promise<boolean>;
}

export interface LocalSiteUserStoreConfig {
  storage: StorageAdapter;
  /** Base directory for user files, e.g. "data/site-users" */
  usersDir: string;
}

/**
 * Flat-file implementation: one JSON file per user, email index for O(1) lookup.
 */
export function createLocalSiteUserStore(config: LocalSiteUserStoreConfig): SiteUserStore {
  const { storage, usersDir } = config;
  const byEmailDir = `${usersDir}/by-email`;

  function encodeEmail(email: string): string {
    // percent-encode the email so it's safe as a filename
    return encodeURIComponent(email.toLowerCase());
  }

  async function getById(id: string): Promise<SiteUser | null> {
    const path = `${usersDir}/${id}.json`;
    try {
      if (!(await storage.exists(path))) return null;
      const data = await storage.read(path);
      return JSON.parse(new TextDecoder().decode(data)) as SiteUser;
    } catch {
      return null;
    }
  }

  async function getByEmail(email: string): Promise<SiteUser | null> {
    const indexPath = `${byEmailDir}/${encodeEmail(email)}.json`;
    try {
      if (!(await storage.exists(indexPath))) return null;
      const data = await storage.read(indexPath);
      const { id } = JSON.parse(new TextDecoder().decode(data)) as { id: string };
      return getById(id);
    } catch {
      return null;
    }
  }

  async function getByProvider(provider: string, providerId: string): Promise<SiteUser | null> {
    // No secondary index for provider lookups — scan all users.
    // Provider logins are infrequent; O(n) is acceptable for a flat-file store.
    try {
      const entries = await storage.list(usersDir);
      for (const entry of entries) {
        if (entry.isDirectory || !entry.name.endsWith(".json")) continue;
        try {
          const data = await storage.read(`${usersDir}/${entry.name}`);
          const user = JSON.parse(new TextDecoder().decode(data)) as SiteUser;
          if (user.provider === provider && user.providerId === providerId) {
            return user;
          }
        } catch {
          // skip corrupt files
        }
      }
    } catch {
      // directory doesn't exist yet
    }
    return null;
  }

  async function create(input: SiteUserCreate): Promise<SiteUser> {
    const id = await generateId();
    const now = Date.now();

    const user: SiteUser = {
      id,
      email: input.email,
      name: input.name,
      avatarUrl: input.avatarUrl,
      provider: input.provider,
      providerId: input.providerId,
      roles: input.roles ?? [],
      createdAt: now,
      lastSeenAt: now,
      enabled: input.enabled !== false,
    };

    await saveUser(user);
    return user;
  }

  async function update(
    id: string,
    updates: Partial<Pick<SiteUser, "name" | "avatarUrl" | "roles" | "lastSeenAt" | "enabled">>,
  ): Promise<SiteUser | null> {
    const user = await getById(id);
    if (!user) return null;

    if (updates.name !== undefined) user.name = updates.name;
    if (updates.avatarUrl !== undefined) user.avatarUrl = updates.avatarUrl;
    if (updates.roles !== undefined) user.roles = updates.roles;
    if (updates.lastSeenAt !== undefined) user.lastSeenAt = updates.lastSeenAt;
    if (updates.enabled !== undefined) user.enabled = updates.enabled;

    await saveUser(user);
    return user;
  }

  async function list(opts: { limit?: number; offset?: number } = {}): Promise<SiteUser[]> {
    const users: SiteUser[] = [];
    try {
      const entries = await storage.list(usersDir);
      for (const entry of entries) {
        if (entry.isDirectory || !entry.name.endsWith(".json")) continue;
        try {
          const data = await storage.read(`${usersDir}/${entry.name}`);
          users.push(JSON.parse(new TextDecoder().decode(data)) as SiteUser);
        } catch {
          // skip corrupt files
        }
      }
    } catch {
      // directory doesn't exist yet
    }

    // Sort by createdAt ascending for stable pagination
    users.sort((a, b) => a.createdAt - b.createdAt);

    const offset = opts.offset ?? 0;
    const limit = opts.limit;
    if (limit !== undefined) {
      return users.slice(offset, offset + limit);
    }
    return users.slice(offset);
  }

  async function deleteUser(id: string): Promise<boolean> {
    const user = await getById(id);
    if (!user) return false;

    // Remove email index entry
    const indexPath = `${byEmailDir}/${encodeEmail(user.email)}.json`;
    try {
      await storage.delete(indexPath);
    } catch {
      // already gone — fine
    }

    const userPath = `${usersDir}/${id}.json`;
    try {
      await storage.delete(userPath);
      return true;
    } catch {
      return false;
    }
  }

  async function saveUser(user: SiteUser): Promise<void> {
    const userPath = `${usersDir}/${user.id}.json`;
    await storage.write(userPath, new TextEncoder().encode(JSON.stringify(user, null, 2)));

    // Write / overwrite the email index entry
    const indexPath = `${byEmailDir}/${encodeEmail(user.email)}.json`;
    await storage.write(indexPath, new TextEncoder().encode(JSON.stringify({ id: user.id })));
  }

  return { getById, getByEmail, getByProvider, create, update, list, delete: deleteUser };
}

async function generateId(): Promise<string> {
  // 16 bytes → 32 hex chars (UUID-like, simpler than v4 format)
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return encodeHex(bytes);
}
