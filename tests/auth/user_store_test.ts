/**
 * Tests for LocalUserStore — CRUD and index lookups.
 */

import {
  assertEquals,
  assertInstanceOf,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createLocalUserStore,
  DuplicateEmailError,
} from "../../src/auth/user-store.ts";

// Minimal in-memory StorageAdapter for tests
function createMemoryStorage() {
  const files = new Map<string, Uint8Array>();
  return {
    async read(path: string) {
      const d = files.get(path);
      if (!d) throw new Error(`Not found: ${path}`);
      return d;
    },
    async readText(path: string) {
      const d = files.get(path);
      if (!d) throw new Error(`Not found: ${path}`);
      return new TextDecoder().decode(d);
    },
    async write(path: string, data: Uint8Array | string) {
      files.set(
        path,
        typeof data === "string" ? new TextEncoder().encode(data) : data,
      );
    },
    async exists(path: string) {
      return files.has(path);
    },
    async delete(path: string) {
      files.delete(path);
    },
    async list(dir: string) {
      const prefix = dir.endsWith("/") ? dir : dir + "/";
      const seen = new Set<string>();
      const result: {
        name: string;
        path: string;
        isFile: boolean;
        isDirectory: boolean;
      }[] = [];
      for (const key of files.keys()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        if (!rest) continue;
        const segment = rest.split("/")[0];
        if (seen.has(segment)) continue;
        seen.add(segment);
        const isDir = rest.includes("/");
        result.push({
          name: segment,
          path: prefix + segment,
          isFile: !isDir,
          isDirectory: isDir,
        });
      }
      return result;
    },
    // unused stubs
    async rename() {},
    async listRecursive() {
      return [];
    },
    async stat() {
      return { size: 0, mtime: 0, isFile: true, isDirectory: false };
    },
    async getJSON() {
      return null;
    },
    async setJSON() {},
    async deleteJSON() {},
    watch() {
      return () => {};
    },
    _files: files,
    // deno-lint-ignore no-explicit-any
  } as any;
}

Deno.test("LocalUserStore: create and getById", async () => {
  const storage = createMemoryStorage();
  const store = createLocalUserStore({
    storage,
    usersDir: "data/site-users",
  });

  const user = await store.create({
    email: "alice@example.com",
    provider: "github",
    providerId: "12345",
    roles: ["member"],
  });

  assertEquals(user.email, "alice@example.com");
  assertEquals(user.provider, "github");
  assertEquals(user.providerId, "12345");
  assertEquals(user.roles, ["member"]);
  assertEquals(user.enabled, true);
  assertEquals(typeof user.id, "string");
  assertEquals(user.id.length, 32); // 16 bytes hex

  const retrieved = await store.getById(user.id);
  assertEquals(retrieved?.email, "alice@example.com");
});

Deno.test("LocalUserStore: getByEmail uses index", async () => {
  const storage = createMemoryStorage();
  const store = createLocalUserStore({
    storage,
    usersDir: "data/site-users",
  });

  const user = await store.create({
    email: "bob@example.com",
    provider: "magic",
    roles: [],
  });

  const found = await store.getByEmail("bob@example.com");
  assertEquals(found?.id, user.id);
});

Deno.test("LocalUserStore: getByEmail returns null for missing", async () => {
  const storage = createMemoryStorage();
  const store = createLocalUserStore({
    storage,
    usersDir: "data/site-users",
  });

  const result = await store.getByEmail("nobody@example.com");
  assertEquals(result, null);
});

Deno.test("LocalUserStore: getByEmail is case-insensitive", async () => {
  const storage = createMemoryStorage();
  const store = createLocalUserStore({
    storage,
    usersDir: "data/site-users",
  });

  await store.create({
    email: "Charlie@Example.COM",
    provider: "google",
    roles: [],
  });

  // Index stores lowercase; lookup normalizes too
  const found = await store.getByEmail("charlie@example.com");
  assertEquals(found !== null, true);
});

Deno.test("LocalUserStore: getByProvider finds user", async () => {
  const storage = createMemoryStorage();
  const store = createLocalUserStore({
    storage,
    usersDir: "data/site-users",
  });

  const user = await store.create({
    email: "dave@example.com",
    provider: "discord",
    providerId: "discord-999",
    roles: [],
  });

  const found = await store.getByProvider("discord", "discord-999");
  assertEquals(found?.id, user.id);
});

Deno.test("LocalUserStore: getByProvider returns null for wrong provider", async () => {
  const storage = createMemoryStorage();
  const store = createLocalUserStore({
    storage,
    usersDir: "data/site-users",
  });

  await store.create({
    email: "eve@example.com",
    provider: "github",
    providerId: "gh-42",
    roles: [],
  });

  const notFound = await store.getByProvider("google", "gh-42");
  assertEquals(notFound, null);
});

// === Phase 5a: unified fields (username/passwordHash/updatedAt) ===

Deno.test("LocalUserStore: create persists username and passwordHash", async () => {
  const storage = createMemoryStorage();
  const store = createLocalUserStore({
    storage,
    usersDir: "data/users",
  });

  const user = await store.create({
    email: "admin@example.com",
    username: "admin",
    passwordHash: "pbkdf2$hash",
    provider: "local",
    roles: ["admin"],
  });

  assertEquals(user.username, "admin");
  assertEquals(user.passwordHash, "pbkdf2$hash");

  const retrieved = await store.getById(user.id);
  assertEquals(retrieved?.username, "admin");
  assertEquals(retrieved?.passwordHash, "pbkdf2$hash");
});

Deno.test("LocalUserStore: create sets updatedAt equal to createdAt", async () => {
  const storage = createMemoryStorage();
  const store = createLocalUserStore({
    storage,
    usersDir: "data/users",
  });

  const user = await store.create({
    email: "fresh@example.com",
    provider: "magic",
    roles: [],
  });

  assertEquals(user.updatedAt, user.createdAt);
});

Deno.test("LocalUserStore: update bumps updatedAt without touching createdAt", async () => {
  const storage = createMemoryStorage();
  const store = createLocalUserStore({
    storage,
    usersDir: "data/users",
  });

  const user = await store.create({
    email: "frank@example.com",
    provider: "magic",
    roles: [],
  });

  await new Promise((r) => setTimeout(r, 5));
  const updated = await store.update(user.id, { name: "Frank" });

  assertEquals(updated?.createdAt, user.createdAt);
  assertEquals((updated?.updatedAt ?? 0) > user.updatedAt, true);
});

Deno.test("LocalUserStore: getByUsername finds a user by username", async () => {
  const storage = createMemoryStorage();
  const store = createLocalUserStore({
    storage,
    usersDir: "data/users",
  });

  const user = await store.create({
    email: "grace@example.com",
    username: "grace",
    passwordHash: "x",
    provider: "local",
    roles: ["editor"],
  });

  const found = await store.getByUsername("grace");
  assertEquals(found?.id, user.id);
});

Deno.test("LocalUserStore: getByUsername returns null when no user has that username", async () => {
  const storage = createMemoryStorage();
  const store = createLocalUserStore({
    storage,
    usersDir: "data/users",
  });

  await store.create({
    email: "heidi@example.com",
    provider: "magic",
    roles: [],
  });

  const found = await store.getByUsername("nobody");
  assertEquals(found, null);
});

Deno.test("LocalUserStore: update can change username and passwordHash", async () => {
  const storage = createMemoryStorage();
  const store = createLocalUserStore({
    storage,
    usersDir: "data/users",
  });

  const user = await store.create({
    email: "ivan@example.com",
    username: "ivan",
    passwordHash: "old-hash",
    provider: "local",
    roles: ["author"],
  });

  const updated = await store.update(user.id, {
    username: "ivan2",
    passwordHash: "new-hash",
  });

  assertEquals(updated?.username, "ivan2");
  assertEquals(updated?.passwordHash, "new-hash");

  const viaOldUsername = await store.getByUsername("ivan");
  assertEquals(viaOldUsername, null);
  const viaNewUsername = await store.getByUsername("ivan2");
  assertEquals(viaNewUsername?.id, user.id);
});

Deno.test("LocalUserStore: update modifies fields", async () => {
  const storage = createMemoryStorage();
  const store = createLocalUserStore({
    storage,
    usersDir: "data/site-users",
  });

  const user = await store.create({
    email: "frank@example.com",
    provider: "github",
    roles: [],
  });

  const updated = await store.update(user.id, {
    name: "Frank",
    roles: ["subscriber"],
    enabled: false,
  });

  assertEquals(updated?.name, "Frank");
  assertEquals(updated?.roles, ["subscriber"]);
  assertEquals(updated?.enabled, false);
});

Deno.test("LocalUserStore: update can change email, old email index entry is removed", async () => {
  const storage = createMemoryStorage();
  const store = createLocalUserStore({
    storage,
    usersDir: "data/users",
  });

  const user = await store.create({
    email: "jane-old@example.com",
    provider: "local",
    roles: [],
  });

  const updated = await store.update(user.id, {
    email: "jane-new@example.com",
  });
  assertEquals(updated?.email, "jane-new@example.com");

  const viaNewEmail = await store.getByEmail("jane-new@example.com");
  assertEquals(viaNewEmail?.id, user.id);

  const viaOldEmail = await store.getByEmail("jane-old@example.com");
  assertEquals(viaOldEmail, null);
});

Deno.test("LocalUserStore: update throws DuplicateEmailError when changing to another user's email", async () => {
  const storage = createMemoryStorage();
  const store = createLocalUserStore({
    storage,
    usersDir: "data/users",
  });

  await store.create({
    email: "taken@example.com",
    provider: "local",
    roles: [],
  });
  const user2 = await store.create({
    email: "available@example.com",
    provider: "local",
    roles: [],
  });

  await assertRejects(
    () => store.update(user2.id, { email: "taken@example.com" }),
    DuplicateEmailError,
  );

  // user2's own record is untouched
  const stillThere = await store.getByEmail("available@example.com");
  assertEquals(stillThere?.id, user2.id);
});

Deno.test("LocalUserStore: update with the same email (different case) is a no-op on the index", async () => {
  const storage = createMemoryStorage();
  const store = createLocalUserStore({
    storage,
    usersDir: "data/users",
  });

  const user = await store.create({
    email: "kim@example.com",
    provider: "local",
    roles: [],
  });
  const updated = await store.update(user.id, {
    email: "Kim@Example.com",
    name: "Kim",
  });

  assertEquals(updated?.name, "Kim");
  const found = await store.getByEmail("kim@example.com");
  assertEquals(found?.id, user.id);
});

Deno.test("LocalUserStore: update returns null for missing user", async () => {
  const storage = createMemoryStorage();
  const store = createLocalUserStore({
    storage,
    usersDir: "data/site-users",
  });

  const result = await store.update("nonexistent", { name: "Ghost" });
  assertEquals(result, null);
});

Deno.test("LocalUserStore: list returns all users sorted by createdAt", async () => {
  const storage = createMemoryStorage();
  const store = createLocalUserStore({
    storage,
    usersDir: "data/site-users",
  });

  await store.create({ email: "a@example.com", provider: "github", roles: [] });
  await store.create({ email: "b@example.com", provider: "google", roles: [] });
  await store.create({ email: "c@example.com", provider: "magic", roles: [] });

  const users = await store.list();
  assertEquals(users.length, 3);
  // Check stable sort order
  assertEquals(users[0].email, "a@example.com");
});

Deno.test("LocalUserStore: list with limit and offset", async () => {
  const storage = createMemoryStorage();
  const store = createLocalUserStore({
    storage,
    usersDir: "data/site-users",
  });

  await store.create({ email: "x@example.com", provider: "github", roles: [] });
  await store.create({ email: "y@example.com", provider: "github", roles: [] });
  await store.create({ email: "z@example.com", provider: "github", roles: [] });

  const page1 = await store.list({ limit: 2, offset: 0 });
  assertEquals(page1.length, 2);

  const page2 = await store.list({ limit: 2, offset: 2 });
  assertEquals(page2.length, 1);
});

Deno.test("LocalUserStore: delete removes user and email index", async () => {
  const storage = createMemoryStorage();
  const store = createLocalUserStore({
    storage,
    usersDir: "data/site-users",
  });

  const user = await store.create({
    email: "gone@example.com",
    provider: "magic",
    roles: [],
  });

  const deleted = await store.delete(user.id);
  assertEquals(deleted, true);

  assertEquals(await store.getById(user.id), null);
  assertEquals(await store.getByEmail("gone@example.com"), null);
});

Deno.test("LocalUserStore: delete returns false for missing user", async () => {
  const storage = createMemoryStorage();
  const store = createLocalUserStore({
    storage,
    usersDir: "data/site-users",
  });

  const result = await store.delete("nonexistent-id");
  assertEquals(result, false);
});

Deno.test("LocalUserStore: getById returns null for missing", async () => {
  const storage = createMemoryStorage();
  const store = createLocalUserStore({
    storage,
    usersDir: "data/site-users",
  });

  assertEquals(await store.getById("no-such-id"), null);
});

Deno.test("LocalUserStore: create respects enabled:false", async () => {
  const storage = createMemoryStorage();
  const store = createLocalUserStore({
    storage,
    usersDir: "data/site-users",
  });

  const user = await store.create({
    email: "disabled@example.com",
    provider: "github",
    roles: [],
    enabled: false,
  });

  assertEquals(user.enabled, false);
});

// ---------------------------------------------------------------------------
// create() email race — Phase 0 of decisions/dec-identity-unification.md
// ---------------------------------------------------------------------------

Deno.test("LocalUserStore: create() throws DuplicateEmailError for an already-used email", async () => {
  const storage = createMemoryStorage();
  const store = createLocalUserStore({
    storage,
    usersDir: "data/site-users",
  });

  await store.create({
    email: "dup@example.com",
    provider: "github",
    roles: [],
  });

  await assertRejects(
    () =>
      store.create({ email: "dup@example.com", provider: "google", roles: [] }),
    DuplicateEmailError,
  );
});

Deno.test("LocalUserStore: DuplicateEmailError check is case-insensitive", async () => {
  const storage = createMemoryStorage();
  const store = createLocalUserStore({
    storage,
    usersDir: "data/site-users",
  });

  await store.create({
    email: "Grace@Example.com",
    provider: "github",
    roles: [],
  });

  await assertRejects(
    () =>
      store.create({
        email: "grace@example.com",
        provider: "google",
        roles: [],
      }),
    DuplicateEmailError,
  );
});

Deno.test("LocalUserStore: two concurrent create() calls for the same email produce exactly one user", async () => {
  const storage = createMemoryStorage();
  const store = createLocalUserStore({
    storage,
    usersDir: "data/site-users",
  });

  const results = await Promise.allSettled([
    store.create({
      email: "race@example.com",
      provider: "github",
      providerId: "gh-1",
      roles: [],
    }),
    store.create({
      email: "race@example.com",
      provider: "google",
      providerId: "go-1",
      roles: [],
    }),
  ]);

  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected");
  assertEquals(fulfilled.length, 1, "exactly one create() call should succeed");
  assertEquals(
    rejected.length,
    1,
    "exactly one create() call should be rejected",
  );
  assertInstanceOf(
    (rejected[0] as PromiseRejectedResult).reason,
    DuplicateEmailError,
  );

  // The critical assertion: no orphaned account. Only the winner's record
  // exists, and it's reachable by email — this is what was silently broken
  // before the fix (the loser's write would win the index race and orphan
  // the winner's user record).
  const all = await store.list();
  assertEquals(all.length, 1);
  const byEmail = await store.getByEmail("race@example.com");
  assertEquals(
    byEmail?.id,
    (fulfilled[0] as PromiseFulfilledResult<{ id: string }>).value.id,
  );
});

// ---------------------------------------------------------------------------
// Legacy `role: string` -> `roles: string[]` normalization on read
// ---------------------------------------------------------------------------
//
// A record written before dec-identity-unification's roles-array migration
// (`role: "admin"` singular, no `roles` field at all) never gets rewritten to
// disk on its own — every consumer that treats `roles` as always present and
// array-shaped (most of @dune/plugin-admin's admin routes do, unguarded)
// would otherwise throw the moment it reads one, including inside mount(),
// where an uncaught throw silently aborts the rest of admin panel setup.

async function writeLegacyRecord(
  // deno-lint-ignore no-explicit-any
  storage: any,
  usersDir: string,
  id: string,
  fields: Record<string, unknown>,
): Promise<void> {
  await storage.write(
    `${usersDir}/${id}.json`,
    JSON.stringify({ id, ...fields }),
  );
}

Deno.test("LocalUserStore: getById normalizes a legacy role:string record to roles:[role]", async () => {
  const storage = createMemoryStorage();
  const store = createLocalUserStore({ storage, usersDir: "data/users" });
  await writeLegacyRecord(storage, "data/users", "legacy-1", {
    email: "legacy@example.com",
    provider: "local",
    role: "admin",
    enabled: true,
  });

  const user = await store.getById("legacy-1");
  assertEquals(user?.roles, ["admin"]);
});

Deno.test("LocalUserStore: getById normalizes a record with neither role nor roles to roles:[]", async () => {
  const storage = createMemoryStorage();
  const store = createLocalUserStore({ storage, usersDir: "data/users" });
  await writeLegacyRecord(storage, "data/users", "legacy-2", {
    email: "norole@example.com",
    provider: "local",
    enabled: true,
  });

  const user = await store.getById("legacy-2");
  assertEquals(user?.roles, []);
});

Deno.test("LocalUserStore: list() normalizes legacy records alongside current-shape ones", async () => {
  const storage = createMemoryStorage();
  const store = createLocalUserStore({ storage, usersDir: "data/users" });
  await writeLegacyRecord(storage, "data/users", "legacy-3", {
    email: "legacy3@example.com",
    provider: "local",
    role: "editor",
    enabled: true,
    createdAt: 1,
  });
  await store.create({
    email: "current@example.com",
    provider: "local",
    roles: ["member"],
  });

  const all = await store.list();
  assertEquals(all.length, 2);
  const legacy = all.find((u) => u.email === "legacy3@example.com");
  assertEquals(legacy?.roles, ["editor"]);
  // The exact bug this guards against: filtering on .roles.includes(...)
  // over a mixed legacy/current list must not throw.
  const admins = all.filter((u) => u.roles.includes("admin"));
  assertEquals(admins.length, 0);
});

Deno.test("LocalUserStore: getByUsername and getByProvider also normalize legacy records", async () => {
  const storage = createMemoryStorage();
  const store = createLocalUserStore({ storage, usersDir: "data/users" });
  await writeLegacyRecord(storage, "data/users", "legacy-4", {
    email: "legacy4@example.com",
    username: "legacyadmin",
    provider: "local",
    providerId: "prov-4",
    role: "admin",
    enabled: true,
  });

  const byUsername = await store.getByUsername("legacyadmin");
  assertEquals(byUsername?.roles, ["admin"]);

  const byProvider = await store.getByProvider("local", "prov-4");
  assertEquals(byProvider?.roles, ["admin"]);
});
