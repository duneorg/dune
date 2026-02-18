/**
 * User management — CRUD operations for admin users.
 *
 * Users are stored as JSON files in data/users/{id}.json (git-tracked).
 * This is persistent, user-authored data — not ephemeral runtime state.
 */

import { encodeHex } from "@std/encoding/hex";
import type { StorageAdapter } from "../../storage/types.ts";
import type { AdminUser, AdminRole } from "../types.ts";
import { hashPassword } from "./passwords.ts";

export interface UserManagerConfig {
  storage: StorageAdapter;
  /** Directory for user files (e.g. ".dune/admin/users") */
  usersDir: string;
}

export interface CreateUserInput {
  username: string;
  email: string;
  password: string;
  role: AdminRole;
  name: string;
}

export interface UserManager {
  /** Create a new user. Returns the user (without password). */
  create(input: CreateUserInput): Promise<AdminUser>;
  /** Get a user by ID */
  getById(id: string): Promise<AdminUser | null>;
  /** Get a user by username */
  getByUsername(username: string): Promise<AdminUser | null>;
  /** List all users */
  list(): Promise<AdminUser[]>;
  /** Update a user (partial update) */
  update(id: string, updates: Partial<Pick<AdminUser, "email" | "role" | "name" | "enabled">>): Promise<AdminUser | null>;
  /** Change a user's password */
  changePassword(id: string, newPassword: string): Promise<boolean>;
  /** Delete a user */
  delete(id: string): Promise<boolean>;
  /** Ensure a default admin user exists (for first-time setup) */
  ensureDefaultAdmin(): Promise<{ created: boolean; password?: string }>;
}

/**
 * Create a user manager backed by the storage adapter.
 */
export function createUserManager(config: UserManagerConfig): UserManager {
  const { storage, usersDir } = config;

  async function create(input: CreateUserInput): Promise<AdminUser> {
    const id = await generateId();
    const now = Date.now();

    const user: AdminUser = {
      id,
      username: input.username,
      email: input.email,
      passwordHash: await hashPassword(input.password),
      role: input.role,
      name: input.name,
      createdAt: now,
      updatedAt: now,
      enabled: true,
    };

    await saveUser(user);
    return user;
  }

  async function getById(id: string): Promise<AdminUser | null> {
    const path = `${usersDir}/${id}.json`;
    try {
      if (!(await storage.exists(path))) return null;
      const data = await storage.read(path);
      return JSON.parse(new TextDecoder().decode(data)) as AdminUser;
    } catch {
      return null;
    }
  }

  async function getByUsername(username: string): Promise<AdminUser | null> {
    const users = await list();
    return users.find((u) => u.username === username) ?? null;
  }

  async function list(): Promise<AdminUser[]> {
    const users: AdminUser[] = [];
    try {
      const entries = await storage.list(usersDir);
      for (const entry of entries) {
        if (entry.isDirectory || !entry.name.endsWith(".json")) continue;
        try {
          const data = await storage.read(`${usersDir}/${entry.name}`);
          users.push(JSON.parse(new TextDecoder().decode(data)) as AdminUser);
        } catch (err) {
          console.warn(`  ⚠️  Skipping corrupt user file: ${entry.name}`, err);
        }
      }
    } catch (err) {
      if (err instanceof Error && !err.message.includes("not found")) {
        console.warn(`  ⚠️  Failed to list users directory:`, err);
      }
      // Directory may not exist yet on first run
    }
    return users;
  }

  async function update(
    id: string,
    updates: Partial<Pick<AdminUser, "email" | "role" | "name" | "enabled">>,
  ): Promise<AdminUser | null> {
    const user = await getById(id);
    if (!user) return null;

    if (updates.email !== undefined) user.email = updates.email;
    if (updates.role !== undefined) user.role = updates.role;
    if (updates.name !== undefined) user.name = updates.name;
    if (updates.enabled !== undefined) user.enabled = updates.enabled;
    user.updatedAt = Date.now();

    await saveUser(user);
    return user;
  }

  async function changePassword(id: string, newPassword: string): Promise<boolean> {
    const user = await getById(id);
    if (!user) return false;

    user.passwordHash = await hashPassword(newPassword);
    user.updatedAt = Date.now();

    await saveUser(user);
    return true;
  }

  async function deleteUser(id: string): Promise<boolean> {
    const path = `${usersDir}/${id}.json`;
    try {
      if (!(await storage.exists(path))) return false;
      await storage.delete(path);
      return true;
    } catch {
      return false;
    }
  }

  async function ensureDefaultAdmin(): Promise<{ created: boolean; password?: string }> {
    const allUsers = await list();
    const admins = allUsers.filter((u) => u.role === "admin" && u.enabled);

    if (admins.length > 0) {
      if (admins.length > 1) {
        console.warn(`  ⚠️  Found ${admins.length} enabled admin users (${admins.map((u) => u.username).join(", ")})`);
      }
      return { created: false };
    }

    if (allUsers.length > 0) {
      console.warn(`  ⚠️  Found ${allUsers.length} user(s) but none are enabled admins — creating default admin`);
    }

    // Generate a random password
    const password = generatePassword();

    await create({
      username: "admin",
      email: "admin@localhost",
      password,
      role: "admin",
      name: "Admin",
    });

    return { created: true, password };
  }

  async function saveUser(user: AdminUser): Promise<void> {
    const path = `${usersDir}/${user.id}.json`;
    const data = new TextEncoder().encode(JSON.stringify(user, null, 2));
    await storage.write(path, data);
  }

  return {
    create,
    getById,
    getByUsername,
    list,
    update,
    changePassword,
    delete: deleteUser,
    ensureDefaultAdmin,
  };
}

async function generateId(): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return encodeHex(bytes);
}

function generatePassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes).map((b) => chars[b % chars.length]).join("");
}
