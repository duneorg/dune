/**
 * Tests for admin auth subsystem: passwords, sessions, users, middleware.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { hashPassword, verifyPassword } from "../../src/admin/auth/passwords.ts";
import { createSessionManager } from "../../src/admin/auth/sessions.ts";
import { createUserManager } from "../../src/admin/auth/users.ts";
import { createAuthMiddleware } from "../../src/admin/auth/middleware.ts";
import { ROLE_PERMISSIONS, toUserInfo } from "../../src/admin/types.ts";

// === In-memory storage for tests ===

function createMemoryStorage() {
  const files = new Map<string, Uint8Array>();
  return {
    async read(path: string) {
      const d = files.get(path);
      if (!d) throw new Error(`Not found: ${path}`);
      return d;
    },
    async write(path: string, data: Uint8Array) { files.set(path, data); },
    async exists(path: string) { return files.has(path); },
    async delete(path: string) { files.delete(path); },
    async list(dir: string) {
      const entries: { name: string; isDirectory: boolean }[] = [];
      const prefix = dir.endsWith("/") ? dir : dir + "/";
      for (const key of files.keys()) {
        if (key.startsWith(prefix)) {
          const rest = key.slice(prefix.length);
          if (!rest.includes("/")) entries.push({ name: rest, isDirectory: false });
        }
      }
      return entries;
    },
    async stat(path: string) {
      const d = files.get(path);
      if (!d) throw new Error(`Not found: ${path}`);
      return { size: d.length, mtime: Date.now(), isFile: true, isDirectory: false };
    },
    _files: files,
  } as any;
}

// === Password hashing ===

Deno.test("hashPassword: produces pbkdf2 format string", async () => {
  const hash = await hashPassword("test123");
  assertEquals(hash.startsWith("pbkdf2:"), true);
  assertEquals(hash.split(":").length, 4);
});

Deno.test("hashPassword: produces different hashes for same password", async () => {
  const hash1 = await hashPassword("test123");
  const hash2 = await hashPassword("test123");
  assertEquals(hash1 !== hash2, true); // Different salts
});

Deno.test("verifyPassword: correct password returns true", async () => {
  const hash = await hashPassword("mypassword");
  assertEquals(await verifyPassword("mypassword", hash), true);
});

Deno.test("verifyPassword: wrong password returns false", async () => {
  const hash = await hashPassword("mypassword");
  assertEquals(await verifyPassword("wrongpassword", hash), false);
});

Deno.test("verifyPassword: invalid hash format returns false", async () => {
  assertEquals(await verifyPassword("test", "invalid-hash"), false);
});

// === Session management ===

Deno.test("SessionManager: create returns session with ID", async () => {
  const storage = createMemoryStorage();
  const mgr = createSessionManager({
    storage,
    sessionsDir: ".sessions",
    lifetime: 3600,
  });

  const session = await mgr.create("user-1");
  assertEquals(session.id.length, 64); // 32 bytes hex
  assertEquals(session.userId, "user-1");
  assertEquals(session.expiresAt > Date.now(), true);
});

Deno.test("SessionManager: get returns valid session", async () => {
  const storage = createMemoryStorage();
  const mgr = createSessionManager({
    storage,
    sessionsDir: ".sessions",
    lifetime: 3600,
  });

  const session = await mgr.create("user-1");
  const retrieved = await mgr.get(session.id);

  assertEquals(retrieved !== null, true);
  assertEquals(retrieved!.userId, "user-1");
});

Deno.test("SessionManager: get returns null for missing session", async () => {
  const storage = createMemoryStorage();
  const mgr = createSessionManager({
    storage,
    sessionsDir: ".sessions",
    lifetime: 3600,
  });

  assertEquals(await mgr.get("nonexistent"), null);
});

Deno.test("SessionManager: revoke deletes session", async () => {
  const storage = createMemoryStorage();
  const mgr = createSessionManager({
    storage,
    sessionsDir: ".sessions",
    lifetime: 3600,
  });

  const session = await mgr.create("user-1");
  await mgr.revoke(session.id);

  assertEquals(await mgr.get(session.id), null);
});

Deno.test("SessionManager: revokeAll removes user sessions", async () => {
  const storage = createMemoryStorage();
  const mgr = createSessionManager({
    storage,
    sessionsDir: ".sessions",
    lifetime: 3600,
  });

  const s1 = await mgr.create("user-1");
  const s2 = await mgr.create("user-1");
  const s3 = await mgr.create("user-2");

  await mgr.revokeAll("user-1");

  assertEquals(await mgr.get(s1.id), null);
  assertEquals(await mgr.get(s2.id), null);
  assertEquals((await mgr.get(s3.id)) !== null, true); // user-2 unaffected
});

Deno.test("SessionManager: expired session returns null", async () => {
  const storage = createMemoryStorage();
  const mgr = createSessionManager({
    storage,
    sessionsDir: ".sessions",
    lifetime: 0, // Expire immediately
  });

  const session = await mgr.create("user-1");
  // Wait a tick
  await new Promise((r) => setTimeout(r, 10));
  assertEquals(await mgr.get(session.id), null);
});

// === User management ===

Deno.test("UserManager: create stores user", async () => {
  const storage = createMemoryStorage();
  const mgr = createUserManager({ storage, usersDir: ".users" });

  const user = await mgr.create({
    username: "alice",
    email: "alice@example.com",
    password: "password123",
    role: "admin",
    name: "Alice",
  });

  assertEquals(user.username, "alice");
  assertEquals(user.email, "alice@example.com");
  assertEquals(user.role, "admin");
  assertEquals(user.enabled, true);
  assertEquals(user.id.length > 0, true);
});

Deno.test("UserManager: getByUsername finds user", async () => {
  const storage = createMemoryStorage();
  const mgr = createUserManager({ storage, usersDir: ".users" });

  await mgr.create({
    username: "bob",
    email: "bob@test.com",
    password: "pass",
    role: "editor",
    name: "Bob",
  });

  const user = await mgr.getByUsername("bob");
  assertEquals(user !== null, true);
  assertEquals(user!.username, "bob");
});

Deno.test("UserManager: getByUsername returns null for missing", async () => {
  const storage = createMemoryStorage();
  const mgr = createUserManager({ storage, usersDir: ".users" });

  assertEquals(await mgr.getByUsername("nobody"), null);
});

Deno.test("UserManager: list returns all users", async () => {
  const storage = createMemoryStorage();
  const mgr = createUserManager({ storage, usersDir: ".users" });

  await mgr.create({ username: "u1", email: "", password: "p", role: "admin", name: "U1" });
  await mgr.create({ username: "u2", email: "", password: "p", role: "editor", name: "U2" });

  const users = await mgr.list();
  assertEquals(users.length, 2);
});

Deno.test("UserManager: update modifies user fields", async () => {
  const storage = createMemoryStorage();
  const mgr = createUserManager({ storage, usersDir: ".users" });

  const user = await mgr.create({
    username: "charlie",
    email: "old@test.com",
    password: "pass",
    role: "author",
    name: "Charlie",
  });

  const updated = await mgr.update(user.id, { email: "new@test.com", role: "editor" });
  assertEquals(updated !== null, true);
  assertEquals(updated!.email, "new@test.com");
  assertEquals(updated!.role, "editor");
  assertEquals(updated!.username, "charlie"); // Unchanged
});

Deno.test("UserManager: changePassword works", async () => {
  const storage = createMemoryStorage();
  const mgr = createUserManager({ storage, usersDir: ".users" });

  const user = await mgr.create({
    username: "dave",
    email: "",
    password: "old-pass",
    role: "admin",
    name: "Dave",
  });

  const changed = await mgr.changePassword(user.id, "new-pass");
  assertEquals(changed, true);

  // Verify new password works
  const updatedUser = await mgr.getById(user.id);
  assertEquals(updatedUser !== null, true);
  assertEquals(await verifyPassword("new-pass", updatedUser!.passwordHash), true);
  assertEquals(await verifyPassword("old-pass", updatedUser!.passwordHash), false);
});

Deno.test("UserManager: delete removes user", async () => {
  const storage = createMemoryStorage();
  const mgr = createUserManager({ storage, usersDir: ".users" });

  const user = await mgr.create({
    username: "ephemeral",
    email: "",
    password: "pass",
    role: "author",
    name: "E",
  });

  assertEquals(await mgr.delete(user.id), true);
  assertEquals(await mgr.getById(user.id), null);
});

Deno.test("UserManager: ensureDefaultAdmin creates admin on first run", async () => {
  const storage = createMemoryStorage();
  const mgr = createUserManager({ storage, usersDir: ".users" });

  const result = await mgr.ensureDefaultAdmin();
  assertEquals(result.created, true);
  assertEquals(typeof result.password, "string");
  assertEquals(result.password!.length, 16);

  // Admin user should exist
  const admin = await mgr.getByUsername("admin");
  assertEquals(admin !== null, true);
  assertEquals(admin!.role, "admin");
});

Deno.test("UserManager: ensureDefaultAdmin skips if admin exists", async () => {
  const storage = createMemoryStorage();
  const mgr = createUserManager({ storage, usersDir: ".users" });

  await mgr.create({
    username: "boss",
    email: "",
    password: "pass",
    role: "admin",
    name: "Boss",
  });

  const result = await mgr.ensureDefaultAdmin();
  assertEquals(result.created, false);
  assertEquals(result.password, undefined);
});

// === Auth middleware ===

Deno.test("AuthMiddleware: authenticate fails without cookie", async () => {
  const storage = createMemoryStorage();
  const sessions = createSessionManager({ storage, sessionsDir: ".sess", lifetime: 3600 });
  const users = createUserManager({ storage, usersDir: ".users" });
  const auth = createAuthMiddleware({ sessions, users });

  const req = new Request("http://localhost/admin/");
  const result = await auth.authenticate(req);

  assertEquals(result.authenticated, false);
});

Deno.test("AuthMiddleware: authenticate succeeds with valid session", async () => {
  const storage = createMemoryStorage();
  const sessions = createSessionManager({ storage, sessionsDir: ".sess", lifetime: 3600 });
  const userMgr = createUserManager({ storage, usersDir: ".users" });
  const auth = createAuthMiddleware({ sessions, users: userMgr });

  const user = await userMgr.create({
    username: "admin",
    email: "",
    password: "pass",
    role: "admin",
    name: "Admin",
  });

  const session = await sessions.create(user.id);
  const req = new Request("http://localhost/admin/", {
    headers: { "Cookie": `dune_session=${session.id}` },
  });

  const result = await auth.authenticate(req);

  assertEquals(result.authenticated, true);
  assertEquals(result.user?.username, "admin");
});

Deno.test("AuthMiddleware: hasPermission checks role", () => {
  const storage = createMemoryStorage();
  const sessions = createSessionManager({ storage, sessionsDir: ".sess", lifetime: 3600 });
  const users = createUserManager({ storage, usersDir: ".users" });
  const auth = createAuthMiddleware({ sessions, users });

  // Admin can delete pages
  const adminResult = {
    authenticated: true,
    user: { role: "admin" } as any,
  };
  assertEquals(auth.hasPermission(adminResult, "pages.delete"), true);

  // Author cannot delete pages
  const authorResult = {
    authenticated: true,
    user: { role: "author" } as any,
  };
  assertEquals(auth.hasPermission(authorResult, "pages.delete"), false);
});

Deno.test("AuthMiddleware: createSessionCookie formats correctly", () => {
  const storage = createMemoryStorage();
  const sessions = createSessionManager({ storage, sessionsDir: ".sess", lifetime: 3600 });
  const users = createUserManager({ storage, usersDir: ".users" });
  const auth = createAuthMiddleware({ sessions, users });

  const cookie = auth.createSessionCookie("abc123", 86400);
  assertEquals(cookie.includes("dune_session=abc123"), true);
  assertEquals(cookie.includes("HttpOnly"), true);
  assertEquals(cookie.includes("Max-Age=86400"), true);
});

// === Types and permissions ===

Deno.test("ROLE_PERMISSIONS: admin has all permissions", () => {
  assertEquals(ROLE_PERMISSIONS.admin.includes("pages.delete"), true);
  assertEquals(ROLE_PERMISSIONS.admin.includes("users.delete"), true);
  assertEquals(ROLE_PERMISSIONS.admin.includes("config.update"), true);
});

Deno.test("ROLE_PERMISSIONS: editor cannot delete pages or manage users", () => {
  assertEquals(ROLE_PERMISSIONS.editor.includes("pages.delete"), false);
  assertEquals(ROLE_PERMISSIONS.editor.includes("users.create"), false);
});

Deno.test("ROLE_PERMISSIONS: author has limited permissions", () => {
  assertEquals(ROLE_PERMISSIONS.author.includes("pages.create"), true);
  assertEquals(ROLE_PERMISSIONS.author.includes("pages.delete"), false);
  assertEquals(ROLE_PERMISSIONS.author.includes("media.delete"), false);
});

Deno.test("toUserInfo: strips password hash", () => {
  const user = {
    id: "123",
    username: "test",
    email: "test@test.com",
    passwordHash: "secret-hash",
    role: "admin" as const,
    name: "Test",
    createdAt: 1000,
    updatedAt: 2000,
    enabled: true,
  };

  const info = toUserInfo(user);
  assertEquals(info.username, "test");
  assertEquals((info as any).passwordHash, undefined);
});
