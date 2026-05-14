/**
 * Tests for LocalSiteUserStore — CRUD and index lookups.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createLocalSiteUserStore } from "../../src/auth/user-store.ts";

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
      files.set(path, typeof data === "string" ? new TextEncoder().encode(data) : data);
    },
    async exists(path: string) { return files.has(path); },
    async delete(path: string) { files.delete(path); },
    async list(dir: string) {
      const prefix = dir.endsWith("/") ? dir : dir + "/";
      const seen = new Set<string>();
      const result: { name: string; path: string; isFile: boolean; isDirectory: boolean }[] = [];
      for (const key of files.keys()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        if (!rest) continue;
        const segment = rest.split("/")[0];
        if (seen.has(segment)) continue;
        seen.add(segment);
        const isDir = rest.includes("/");
        result.push({ name: segment, path: prefix + segment, isFile: !isDir, isDirectory: isDir });
      }
      return result;
    },
    // unused stubs
    async rename() {},
    async listRecursive() { return []; },
    async stat() { return { size: 0, mtime: 0, isFile: true, isDirectory: false }; },
    async getJSON() { return null; },
    async setJSON() {},
    async deleteJSON() {},
    watch() { return () => {}; },
    _files: files,
  // deno-lint-ignore no-explicit-any
  } as any;
}

Deno.test("LocalSiteUserStore: create and getById", async () => {
  const storage = createMemoryStorage();
  const store = createLocalSiteUserStore({ storage, usersDir: "data/site-users" });

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

Deno.test("LocalSiteUserStore: getByEmail uses index", async () => {
  const storage = createMemoryStorage();
  const store = createLocalSiteUserStore({ storage, usersDir: "data/site-users" });

  const user = await store.create({
    email: "bob@example.com",
    provider: "magic",
    roles: [],
  });

  const found = await store.getByEmail("bob@example.com");
  assertEquals(found?.id, user.id);
});

Deno.test("LocalSiteUserStore: getByEmail returns null for missing", async () => {
  const storage = createMemoryStorage();
  const store = createLocalSiteUserStore({ storage, usersDir: "data/site-users" });

  const result = await store.getByEmail("nobody@example.com");
  assertEquals(result, null);
});

Deno.test("LocalSiteUserStore: getByEmail is case-insensitive", async () => {
  const storage = createMemoryStorage();
  const store = createLocalSiteUserStore({ storage, usersDir: "data/site-users" });

  await store.create({ email: "Charlie@Example.COM", provider: "google", roles: [] });

  // Index stores lowercase; lookup normalizes too
  const found = await store.getByEmail("charlie@example.com");
  assertEquals(found !== null, true);
});

Deno.test("LocalSiteUserStore: getByProvider finds user", async () => {
  const storage = createMemoryStorage();
  const store = createLocalSiteUserStore({ storage, usersDir: "data/site-users" });

  const user = await store.create({
    email: "dave@example.com",
    provider: "discord",
    providerId: "discord-999",
    roles: [],
  });

  const found = await store.getByProvider("discord", "discord-999");
  assertEquals(found?.id, user.id);
});

Deno.test("LocalSiteUserStore: getByProvider returns null for wrong provider", async () => {
  const storage = createMemoryStorage();
  const store = createLocalSiteUserStore({ storage, usersDir: "data/site-users" });

  await store.create({
    email: "eve@example.com",
    provider: "github",
    providerId: "gh-42",
    roles: [],
  });

  const notFound = await store.getByProvider("google", "gh-42");
  assertEquals(notFound, null);
});

Deno.test("LocalSiteUserStore: update modifies fields", async () => {
  const storage = createMemoryStorage();
  const store = createLocalSiteUserStore({ storage, usersDir: "data/site-users" });

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

Deno.test("LocalSiteUserStore: update returns null for missing user", async () => {
  const storage = createMemoryStorage();
  const store = createLocalSiteUserStore({ storage, usersDir: "data/site-users" });

  const result = await store.update("nonexistent", { name: "Ghost" });
  assertEquals(result, null);
});

Deno.test("LocalSiteUserStore: list returns all users sorted by createdAt", async () => {
  const storage = createMemoryStorage();
  const store = createLocalSiteUserStore({ storage, usersDir: "data/site-users" });

  await store.create({ email: "a@example.com", provider: "github", roles: [] });
  await store.create({ email: "b@example.com", provider: "google", roles: [] });
  await store.create({ email: "c@example.com", provider: "magic", roles: [] });

  const users = await store.list();
  assertEquals(users.length, 3);
  // Check stable sort order
  assertEquals(users[0].email, "a@example.com");
});

Deno.test("LocalSiteUserStore: list with limit and offset", async () => {
  const storage = createMemoryStorage();
  const store = createLocalSiteUserStore({ storage, usersDir: "data/site-users" });

  await store.create({ email: "x@example.com", provider: "github", roles: [] });
  await store.create({ email: "y@example.com", provider: "github", roles: [] });
  await store.create({ email: "z@example.com", provider: "github", roles: [] });

  const page1 = await store.list({ limit: 2, offset: 0 });
  assertEquals(page1.length, 2);

  const page2 = await store.list({ limit: 2, offset: 2 });
  assertEquals(page2.length, 1);
});

Deno.test("LocalSiteUserStore: delete removes user and email index", async () => {
  const storage = createMemoryStorage();
  const store = createLocalSiteUserStore({ storage, usersDir: "data/site-users" });

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

Deno.test("LocalSiteUserStore: delete returns false for missing user", async () => {
  const storage = createMemoryStorage();
  const store = createLocalSiteUserStore({ storage, usersDir: "data/site-users" });

  const result = await store.delete("nonexistent-id");
  assertEquals(result, false);
});

Deno.test("LocalSiteUserStore: getById returns null for missing", async () => {
  const storage = createMemoryStorage();
  const store = createLocalSiteUserStore({ storage, usersDir: "data/site-users" });

  assertEquals(await store.getById("no-such-id"), null);
});

Deno.test("LocalSiteUserStore: create respects enabled:false", async () => {
  const storage = createMemoryStorage();
  const store = createLocalSiteUserStore({ storage, usersDir: "data/site-users" });

  const user = await store.create({
    email: "disabled@example.com",
    provider: "github",
    roles: [],
    enabled: false,
  });

  assertEquals(user.enabled, false);
});
