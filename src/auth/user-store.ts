/**
 * User store — CRUD operations for the unified account record shared by
 * the admin panel and public site visitors (dec-identity-unification Phase 5).
 *
 * Users are stored as JSON files in data/users/{id}.json.
 * An email index at data/users/by-email/{encodedEmail}.json contains
 * just { id } for O(1) email lookup without scanning all user files.
 */

import { encodeHex } from "@std/encoding/hex";
import type { StorageAdapter } from "../storage/types.ts";
import type { User, UserCreate } from "./types.ts";

/**
 * Thrown by `create()` when a user with the given email already exists.
 * Callers that raced another request for the same email should catch this
 * and re-fetch via `getByEmail()` to get the winner's record, rather than
 * treating it as a hard failure.
 */
export class DuplicateEmailError extends Error {
  override name = "DuplicateEmailError";
  constructor(email: string) {
    super(`A user with email ${email} already exists`);
  }
}

export interface UserStore {
  getById(id: string): Promise<User | null>;
  getByEmail(email: string): Promise<User | null>;
  getByUsername(username: string): Promise<User | null>;
  getByProvider(provider: string, providerId: string): Promise<User | null>;
  /** @throws {DuplicateEmailError} if a user with this email already exists. */
  create(user: UserCreate): Promise<User>;
  /** @throws {DuplicateEmailError} if `updates.email` is set and already used by a different user. */
  update(
    id: string,
    updates: Partial<
      Pick<
        User,
        | "email"
        | "name"
        | "avatarUrl"
        | "username"
        | "passwordHash"
        | "roles"
        | "lastSeenAt"
        | "enabled"
        | "stripeCustomerId"
      >
    >,
  ): Promise<User | null>;
  list(opts?: { limit?: number; offset?: number }): Promise<User[]>;
  delete(id: string): Promise<boolean>;
}

export interface LocalUserStoreConfig {
  storage: StorageAdapter;
  /** Base directory for user files, e.g. "data/users" */
  usersDir: string;
}

/**
 * Flat-file implementation: one JSON file per user, email index for O(1) lookup.
 */
export function createLocalUserStore(
  config: LocalUserStoreConfig,
): UserStore {
  const { storage, usersDir } = config;
  const byEmailDir = `${usersDir}/by-email`;

  // Serializes create() calls for the same email so a check-then-write race
  // (two concurrent signups with the same email) can't both pass the
  // getByEmail() check and both write — the second one's re-check (below,
  // now running after the first's write completes) sees the winner and
  // throws DuplicateEmailError instead of silently overwriting the email
  // index and orphaning the first account. In-process only — correct for
  // this store's documented single-process deployment model (the db tier
  // gets the same guarantee for free via a real UNIQUE constraint).
  const emailLocks = new Map<string, Promise<void>>();

  async function withEmailLock<T>(
    email: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const key = email.toLowerCase();
    const previous = emailLocks.get(key) ?? Promise.resolve();
    const chained = previous.then(fn);
    const tail = chained.then(() => {}, () => {});
    emailLocks.set(key, tail);
    try {
      return await chained;
    } finally {
      if (emailLocks.get(key) === tail) emailLocks.delete(key);
    }
  }

  function encodeEmail(email: string): string {
    // percent-encode the email so it's safe as a filename
    return encodeURIComponent(email.toLowerCase());
  }

  /**
   * Parse a raw user record, normalizing the pre-dec-identity-unification
   * `role: string` shape into `roles: string[]` on read. A record written
   * before that migration never gets rewritten to disk on its own, so every
   * call site that treats `roles` as always present/array-shaped (most of
   * `@dune/plugin-admin`'s admin routes do, unguarded) would otherwise throw
   * the moment it touches one — including inside `mount()`, where an
   * uncaught throw here silently aborts the rest of admin panel setup.
   * Normalizing once, centrally, at the only place records actually get
   * deserialized is cheaper and safer than guarding every consumer.
   */
  function parseUserRecord(raw: string): User {
    const parsed = JSON.parse(raw) as User & { role?: string };
    if (!Array.isArray(parsed.roles)) {
      parsed.roles = typeof parsed.role === "string" ? [parsed.role] : [];
    }
    return parsed;
  }

  async function getById(id: string): Promise<User | null> {
    const path = `${usersDir}/${id}.json`;
    try {
      if (!(await storage.exists(path))) return null;
      const data = await storage.read(path);
      return parseUserRecord(new TextDecoder().decode(data));
    } catch {
      return null;
    }
  }

  async function getByEmail(email: string): Promise<User | null> {
    const indexPath = `${byEmailDir}/${encodeEmail(email)}.json`;
    try {
      if (!(await storage.exists(indexPath))) return null;
      const data = await storage.read(indexPath);
      const { id } = JSON.parse(new TextDecoder().decode(data)) as {
        id: string;
      };
      return getById(id);
    } catch {
      return null;
    }
  }

  async function getByUsername(username: string): Promise<User | null> {
    // No secondary index for username lookups — scan all users. Matches
    // @dune/plugin-admin's pre-Phase-5 UserManager.getByUsername(), which
    // did the same full-scan; not a regression, and admin installs are
    // small (see dec-identity-unification.md's "low migration risk" note).
    try {
      const entries = await storage.list(usersDir);
      for (const entry of entries) {
        if (entry.isDirectory || !entry.name.endsWith(".json")) continue;
        try {
          const data = await storage.read(`${usersDir}/${entry.name}`);
          const user = parseUserRecord(new TextDecoder().decode(data));
          if (user.username === username) return user;
        } catch {
          // skip corrupt files
        }
      }
    } catch {
      // directory doesn't exist yet
    }
    return null;
  }

  async function getByProvider(
    provider: string,
    providerId: string,
  ): Promise<User | null> {
    // No secondary index for provider lookups — scan all users.
    // Provider logins are infrequent; O(n) is acceptable for a flat-file store.
    try {
      const entries = await storage.list(usersDir);
      for (const entry of entries) {
        if (entry.isDirectory || !entry.name.endsWith(".json")) continue;
        try {
          const data = await storage.read(`${usersDir}/${entry.name}`);
          const user = parseUserRecord(new TextDecoder().decode(data));
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

  async function create(input: UserCreate): Promise<User> {
    return withEmailLock(input.email, async () => {
      // Re-check under the lock — a concurrent create() for the same email
      // may have already won the race and completed while this call was
      // queued (see withEmailLock above).
      const existing = await getByEmail(input.email);
      if (existing) throw new DuplicateEmailError(input.email);

      const id = await generateId();
      const now = Date.now();

      const user: User = {
        id,
        email: input.email,
        name: input.name,
        avatarUrl: input.avatarUrl,
        username: input.username,
        passwordHash: input.passwordHash,
        provider: input.provider,
        providerId: input.providerId,
        roles: input.roles ?? [],
        createdAt: now,
        updatedAt: now,
        lastSeenAt: now,
        enabled: input.enabled !== false,
        stripeCustomerId: input.stripeCustomerId,
      };

      await saveUser(user);
      return user;
    });
  }

  async function update(
    id: string,
    updates: Partial<
      Pick<
        User,
        | "email"
        | "name"
        | "avatarUrl"
        | "username"
        | "passwordHash"
        | "roles"
        | "lastSeenAt"
        | "enabled"
        | "stripeCustomerId"
      >
    >,
  ): Promise<User | null> {
    // Email changes touch the by-email index (a second file), so they're
    // locked the same way create() is — a concurrent create()/update() for
    // the target email can't win the race and be silently overwritten.
    const newEmail = updates.email;
    if (newEmail !== undefined) {
      return withEmailLock(newEmail, () => applyUpdate(id, updates));
    }
    return applyUpdate(id, updates);
  }

  async function applyUpdate(
    id: string,
    updates: Partial<
      Pick<
        User,
        | "email"
        | "name"
        | "avatarUrl"
        | "username"
        | "passwordHash"
        | "roles"
        | "lastSeenAt"
        | "enabled"
        | "stripeCustomerId"
      >
    >,
  ): Promise<User | null> {
    const user = await getById(id);
    if (!user) return null;

    const oldEmail = user.email;
    if (
      updates.email !== undefined &&
      updates.email.toLowerCase() !== oldEmail.toLowerCase()
    ) {
      const existing = await getByEmail(updates.email);
      if (existing && existing.id !== id) {
        throw new DuplicateEmailError(updates.email);
      }
      user.email = updates.email;
    }
    if (updates.name !== undefined) user.name = updates.name;
    if (updates.avatarUrl !== undefined) user.avatarUrl = updates.avatarUrl;
    if (updates.username !== undefined) user.username = updates.username;
    if (updates.passwordHash !== undefined) {
      user.passwordHash = updates.passwordHash;
    }
    if (updates.roles !== undefined) user.roles = updates.roles;
    if (updates.lastSeenAt !== undefined) user.lastSeenAt = updates.lastSeenAt;
    if (updates.enabled !== undefined) user.enabled = updates.enabled;
    if (updates.stripeCustomerId !== undefined) {
      user.stripeCustomerId = updates.stripeCustomerId;
    }
    user.updatedAt = Date.now();

    await saveUser(user);
    if (user.email !== oldEmail) {
      // Remove the stale index entry for the old email now that the new
      // one has been written by saveUser().
      const staleIndexPath = `${byEmailDir}/${encodeEmail(oldEmail)}.json`;
      await storage.delete(staleIndexPath).catch(() => {});
    }
    return user;
  }

  async function list(
    opts: { limit?: number; offset?: number } = {},
  ): Promise<User[]> {
    const users: User[] = [];
    try {
      const entries = await storage.list(usersDir);
      for (const entry of entries) {
        if (entry.isDirectory || !entry.name.endsWith(".json")) continue;
        try {
          const data = await storage.read(`${usersDir}/${entry.name}`);
          users.push(parseUserRecord(new TextDecoder().decode(data)));
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

  async function saveUser(user: User): Promise<void> {
    const userPath = `${usersDir}/${user.id}.json`;
    await storage.write(
      userPath,
      new TextEncoder().encode(JSON.stringify(user, null, 2)),
    );

    // Write / overwrite the email index entry
    const indexPath = `${byEmailDir}/${encodeEmail(user.email)}.json`;
    await storage.write(
      indexPath,
      new TextEncoder().encode(JSON.stringify({ id: user.id })),
    );
  }

  return {
    getById,
    getByEmail,
    getByUsername,
    getByProvider,
    create,
    update,
    list,
    delete: deleteUser,
  };
}

async function generateId(): Promise<string> {
  // 16 bytes → 32 hex chars (UUID-like, simpler than v4 format)
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return encodeHex(bytes);
}
