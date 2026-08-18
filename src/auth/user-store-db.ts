/**
 * DbUserStore — database-backed User store (dec-identity-unification Phase 5).
 *
 * Uses Dune's DbAdapter directly (raw queries) rather than the generic
 * Repository<T> layer, because the roles field requires JSON round-trip
 * that the generic layer's type system can't express cleanly.
 *
 * Table: users
 * Mirrors the User shape — roles stored as a JSON string column.
 */

import type { DbAdapter } from "../db/types.ts";
import type { User, UserCreate } from "./types.ts";
import type { UserStore } from "./user-store.ts";

// ── DB row shape (roles as JSON string) ──────────────────────────────────────

interface DbRow {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  username: string | null;
  passwordHash: string | null;
  provider: string;
  providerId: string | null;
  roles: string; // JSON array
  createdAt: number;
  updatedAt: number;
  lastSeenAt: number;
  enabled: number | boolean; // SQLite returns 0/1
  stripeCustomerId: string | null;
}

function rowToUser(row: DbRow): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name ?? undefined,
    avatarUrl: row.avatarUrl ?? undefined,
    username: row.username ?? undefined,
    passwordHash: row.passwordHash ?? undefined,
    provider: row.provider,
    providerId: row.providerId ?? undefined,
    roles: typeof row.roles === "string" ? JSON.parse(row.roles) : row.roles,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastSeenAt: row.lastSeenAt,
    enabled: Boolean(row.enabled),
    stripeCustomerId: row.stripeCustomerId ?? undefined,
  };
}

// ── KV guard ─────────────────────────────────────────────────────────────────

function assertNotKv(adapter: DbAdapter): void {
  if ("_kv" in adapter || (adapter.constructor && adapter.constructor.name === "KVAdapter")) {
    throw new Error(
      "[dune/auth] userStore: db requires a SQL-capable database (SQLite or Postgres). " +
        "The Deno KV adapter does not support raw SQL. " +
        "Set DUNE_DB_URL (Postgres) or DUNE_DB_PATH (SQLite), " +
        "or switch to userStore: local.",
    );
  }
}

// ── Table bootstrap ───────────────────────────────────────────────────────────

async function ensureTable(db: DbAdapter): Promise<void> {
  assertNotKv(db);
  await db.query(`
    CREATE TABLE IF NOT EXISTS site_users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT,
      avatarUrl TEXT,
      username TEXT UNIQUE,
      passwordHash TEXT,
      provider TEXT NOT NULL,
      providerId TEXT,
      roles TEXT NOT NULL DEFAULT '[]',
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      lastSeenAt INTEGER NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      stripeCustomerId TEXT
    )
  `);
  await db.query(
    `CREATE INDEX IF NOT EXISTS idx_site_users_provider ON site_users (provider, providerId)`,
  ).catch(() => {});

  // Additive schema migration for installs upgrading from before Phase 5's
  // username/passwordHash/updatedAt columns existed — `CREATE TABLE IF NOT
  // EXISTS` above is a no-op against an already-existing table, so a fresh
  // ALTER is needed to backfill these on an existing site_users table.
  // Column-already-exists errors are the expected steady-state outcome
  // (every boot after the first) and are swallowed; any other failure
  // (permissions, connectivity) is expected to have already surfaced from
  // the CREATE TABLE/INDEX statements above.
  await db.query(`ALTER TABLE site_users ADD COLUMN username TEXT`).catch(() => {});
  await db.query(`ALTER TABLE site_users ADD COLUMN passwordHash TEXT`).catch(() => {});
  await db.query(`ALTER TABLE site_users ADD COLUMN updatedAt INTEGER NOT NULL DEFAULT 0`).catch(() => {});
}

// ── Store factory ─────────────────────────────────────────────────────────────

export async function createDbUserStore(config: { adapter: DbAdapter }): Promise<UserStore> {
  const db = config.adapter;
  await ensureTable(db);

  const store: UserStore = {
    async getById(id: string): Promise<User | null> {
      const rows = await db.query<DbRow>(
        "SELECT * FROM site_users WHERE id = ? LIMIT 1",
        [id],
      );
      return rows[0] ? rowToUser(rows[0]) : null;
    },

    async getByEmail(email: string): Promise<User | null> {
      const rows = await db.query<DbRow>(
        "SELECT * FROM site_users WHERE email = ? LIMIT 1",
        [email],
      );
      return rows[0] ? rowToUser(rows[0]) : null;
    },

    async getByUsername(username: string): Promise<User | null> {
      const rows = await db.query<DbRow>(
        "SELECT * FROM site_users WHERE username = ? LIMIT 1",
        [username],
      );
      return rows[0] ? rowToUser(rows[0]) : null;
    },

    async getByProvider(provider: string, providerId: string): Promise<User | null> {
      const rows = await db.query<DbRow>(
        "SELECT * FROM site_users WHERE provider = ? AND providerId = ? LIMIT 1",
        [provider, providerId],
      );
      return rows[0] ? rowToUser(rows[0]) : null;
    },

    async create(data: UserCreate): Promise<User> {
      const id = crypto.randomUUID();
      const now = Date.now();
      const user: User = {
        id,
        email: data.email,
        name: data.name,
        avatarUrl: data.avatarUrl,
        username: data.username,
        passwordHash: data.passwordHash,
        provider: data.provider,
        providerId: data.providerId,
        roles: data.roles ?? [],
        createdAt: now,
        updatedAt: now,
        lastSeenAt: now,
        enabled: data.enabled ?? true,
        stripeCustomerId: data.stripeCustomerId,
      };
      await db.query(
        `INSERT INTO site_users
           (id, email, name, avatarUrl, username, passwordHash, provider, providerId, roles, createdAt, updatedAt, lastSeenAt, enabled, stripeCustomerId)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          user.id, user.email, user.name ?? null, user.avatarUrl ?? null,
          user.username ?? null, user.passwordHash ?? null,
          user.provider, user.providerId ?? null, JSON.stringify(user.roles),
          user.createdAt, user.updatedAt, user.lastSeenAt, user.enabled ? 1 : 0, user.stripeCustomerId ?? null,
        ],
      );
      return user;
    },

    async update(
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
      const sets: string[] = ["updatedAt = ?"];
      const params: unknown[] = [Date.now()];

      // No DuplicateEmailError translation here — matches create()'s existing
      // behavior on this tier: the UNIQUE constraint gives atomicity, but a
      // conflicting write surfaces as a raw DB error, not a typed one. A
      // pre-existing gap on this tier (see decisions/dec-identity-
      // unification.md), not introduced by this email-update addition.
      if ("email" in updates) { sets.push("email = ?"); params.push(updates.email); }
      if ("name" in updates) { sets.push("name = ?"); params.push(updates.name ?? null); }
      if ("avatarUrl" in updates) { sets.push("avatarUrl = ?"); params.push(updates.avatarUrl ?? null); }
      if ("username" in updates) { sets.push("username = ?"); params.push(updates.username ?? null); }
      if ("passwordHash" in updates) { sets.push("passwordHash = ?"); params.push(updates.passwordHash ?? null); }
      if ("roles" in updates) { sets.push("roles = ?"); params.push(JSON.stringify(updates.roles ?? [])); }
      if ("lastSeenAt" in updates) { sets.push("lastSeenAt = ?"); params.push(updates.lastSeenAt); }
      if ("enabled" in updates) { sets.push("enabled = ?"); params.push(updates.enabled ? 1 : 0); }
      if ("stripeCustomerId" in updates) { sets.push("stripeCustomerId = ?"); params.push(updates.stripeCustomerId ?? null); }

      params.push(id);
      await db.query(`UPDATE site_users SET ${sets.join(", ")} WHERE id = ?`, params);
      return store.getById(id);
    },

    async delete(id: string): Promise<boolean> {
      await db.query("DELETE FROM site_users WHERE id = ?", [id]);
      return true;
    },

    async list(opts?: { limit?: number; offset?: number }): Promise<User[]> {
      // OFFSET requires LIMIT in standard SQL — always emit LIMIT when OFFSET is requested
      let sql = "SELECT * FROM site_users ORDER BY createdAt ASC";
      const params: unknown[] = [];
      if (opts?.limit !== undefined || opts?.offset !== undefined) {
        sql += " LIMIT ?";
        params.push(opts.limit ?? 2147483647); // max int when only offset given
      }
      if (opts?.offset !== undefined) {
        sql += " OFFSET ?";
        params.push(opts.offset);
      }
      const rows = await db.query<DbRow>(sql, params);
      return rows.map(rowToUser);
    },
  };

  return store;
}
