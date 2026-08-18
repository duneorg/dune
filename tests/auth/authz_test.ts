/**
 * Tests for AuthzLocalAdapter and the Dune AuthSystem integration.
 *
 * Verifies:
 *   - AuthzLocalAdapter: write, delete, findTuples, findSubjects, findObjects
 *   - AuthSystem round-trip: addMember → check
 *   - bootstrapRoleTuples: derives tuples from User.roles[]
 *   - checkRolesAsync: uses authz when wired via setGatingAuthz
 */

import {
  assertEquals,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { AuthzLocalAdapter } from "../../src/auth/authz-adapter-local.ts";
import {
  bootstrapAdminTuples,
  bootstrapRoleTuples,
  createDuneAuthSystem,
} from "../../src/auth/authz.ts";
import { checkRolesAsync, setGatingAuthz } from "../../src/auth/gating.ts";
import type { User } from "../../src/auth/types.ts";

// ── In-memory StorageAdapter for tests ────────────────────────────────────────

function makeStorage() {
  const files = new Map<string, Uint8Array>();
  return {
    async read(path: string) {
      const data = files.get(path);
      if (!data) throw new Error(`Not found: ${path}`);
      return data;
    },
    async readText(path: string) {
      return new TextDecoder().decode(await this.read(path));
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
    async rename(oldPath: string, newPath: string) {
      const data = files.get(oldPath);
      if (!data) throw new Error(`Not found: ${oldPath}`);
      files.set(newPath, data);
      files.delete(oldPath);
    },
    async list(dir: string) {
      const entries = [];
      for (const [path] of files) {
        if (
          path.startsWith(dir + "/") &&
          !path.slice(dir.length + 1).includes("/")
        ) {
          const name = path.slice(dir.length + 1);
          entries.push({ name, path, isFile: true, isDirectory: false });
        }
      }
      return entries;
    },
    async listRecursive(dir: string) {
      return this.list(dir);
    },
    async stat(path: string) {
      return {
        isFile: files.has(path),
        isDirectory: false,
        size: files.get(path)?.length ?? 0,
        mtime: 0,
      };
    },
    async getJSON<T>(key: string): Promise<T | null> {
      const data = files.get(`__json__/${key}`);
      if (!data) return null;
      return JSON.parse(new TextDecoder().decode(data));
    },
    async setJSON<T>(key: string, value: T): Promise<void> {
      files.set(
        `__json__/${key}`,
        new TextEncoder().encode(JSON.stringify(value)),
      );
    },
    async deleteJSON(key: string): Promise<void> {
      files.delete(`__json__/${key}`);
    },
    watch(_path: string, _cb: unknown) {
      return () => {};
    },
  } as import("../../src/storage/types.ts").StorageAdapter;
}

function makeUser(id: string, roles: string[]): User {
  return {
    id,
    email: `${id}@example.com`,
    provider: "magic",
    roles,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastSeenAt: Date.now(),
    enabled: true,
  };
}

// ── AuthzLocalAdapter ─────────────────────────────────────────────────────────

Deno.test("AuthzLocalAdapter: write then findTuples by subject", async () => {
  const adapter = new AuthzLocalAdapter({
    storage: makeStorage(),
    dataDir: "data",
  });
  const [stored] = await adapter.write([{
    subject: { type: "user", id: "alice" },
    relation: "member",
    object: { type: "group", id: "member" },
  }]);
  const tuples = await adapter.findTuples({
    subject: { type: "user", id: "alice" },
  });
  assertEquals(tuples.length, 1);
  assertEquals(tuples[0].id, stored.id);
  assertEquals(tuples[0].relation, "member");
});

Deno.test("AuthzLocalAdapter: write then findSubjects", async () => {
  const adapter = new AuthzLocalAdapter({
    storage: makeStorage(),
    dataDir: "data",
  });
  await adapter.write([{
    subject: { type: "user", id: "alice" },
    relation: "member",
    object: { type: "group", id: "premium" },
  }]);
  const subjects = await adapter.findSubjects(
    { type: "group", id: "premium" },
    "member",
  );
  assertEquals(subjects.length, 1);
  assertEquals(subjects[0].id, "alice");
});

Deno.test("AuthzLocalAdapter: write then findObjects", async () => {
  const adapter = new AuthzLocalAdapter({
    storage: makeStorage(),
    dataDir: "data",
  });
  await adapter.write([{
    subject: { type: "user", id: "bob" },
    relation: "member",
    object: { type: "group", id: "member" },
  }]);
  const objects = await adapter.findObjects(
    { type: "user", id: "bob" },
    "member",
  );
  assertEquals(objects.length, 1);
  assertEquals(objects[0].id, "member");
});

Deno.test("AuthzLocalAdapter: delete by subject removes tuple", async () => {
  const adapter = new AuthzLocalAdapter({
    storage: makeStorage(),
    dataDir: "data",
  });
  await adapter.write([{
    subject: { type: "user", id: "charlie" },
    relation: "member",
    object: { type: "group", id: "member" },
  }]);
  const deleted = await adapter.delete({
    who: { type: "user", id: "charlie" },
  });
  assertEquals(deleted, 1);
  const tuples = await adapter.findTuples({
    subject: { type: "user", id: "charlie" },
  });
  assertEquals(tuples.length, 0);
});

Deno.test("AuthzLocalAdapter: hasTuple returns true when present", async () => {
  const adapter = new AuthzLocalAdapter({
    storage: makeStorage(),
    dataDir: "data",
  });
  await adapter.write([{
    subject: { type: "user", id: "dave" },
    relation: "member",
    object: { type: "group", id: "vip" },
  }]);
  const exists = await adapter.hasTuple(
    { type: "user", id: "dave" },
    "member",
    { type: "group", id: "vip" },
  );
  assertStrictEquals(exists, true);
});

Deno.test("AuthzLocalAdapter: hasTuple returns false when absent", async () => {
  const adapter = new AuthzLocalAdapter({
    storage: makeStorage(),
    dataDir: "data",
  });
  const exists = await adapter.hasTuple(
    { type: "user", id: "eve" },
    "member",
    { type: "group", id: "vip" },
  );
  assertStrictEquals(exists, false);
});

// ── Indexed lookups (Phase 1 of decisions/dec-identity-unification.md) ────────
//
// hasTuple()/findSubjects()/findObjects() now go through composite-key
// indexes instead of a linear scan over every tuple. These tests exist to
// prove correctness at a scale where a bug in the indexing (wrong key,
// missed unindex on delete, index/store desync after a disk reload) would
// actually show up as a wrong result — a 1-2 tuple test can't distinguish
// "correctly indexed" from "correctly scanned."

Deno.test("AuthzLocalAdapter: indexed lookups stay correct across many tuples and relations", async () => {
  const adapter = new AuthzLocalAdapter({
    storage: makeStorage(),
    dataDir: "data",
  });

  // 20 users, each a member of "member", and split across two other groups —
  // exercises multiple relations sharing the same object, and multiple
  // objects sharing the same relation, which a wrong composite key could
  // easily conflate.
  for (let i = 0; i < 20; i++) {
    await adapter.write([{
      subject: { type: "user", id: `user-${i}` },
      relation: "member",
      object: { type: "group", id: "member" },
    }]);
    await adapter.write([{
      subject: { type: "user", id: `user-${i}` },
      relation: "member",
      object: { type: "group", id: i % 2 === 0 ? "even" : "odd" },
    }]);
  }
  // A few users also get a direct "editor" relation on the admin app —
  // different relation, different object type, same subject type.
  for (let i = 0; i < 5; i++) {
    await adapter.write([{
      subject: { type: "user", id: `user-${i}` },
      relation: "editor",
      object: { type: "app", id: "admin" },
    }]);
  }

  const members = await adapter.findSubjects(
    { type: "group", id: "member" },
    "member",
  );
  assertEquals(members.length, 20);

  const evens = await adapter.findSubjects(
    { type: "group", id: "even" },
    "member",
  );
  assertEquals(evens.length, 10);
  assertEquals(evens.every((s) => Number(s.id.split("-")[1]) % 2 === 0), true);

  const editors = await adapter.findSubjects(
    { type: "app", id: "admin" },
    "editor",
  );
  assertEquals(editors.length, 5);

  // findObjects: user-0 is a member of "member" and "even", and editor of admin.
  const user0Memberships = await adapter.findObjects({
    type: "user",
    id: "user-0",
  }, "member");
  assertEquals(user0Memberships.map((o) => o.id).sort(), ["even", "member"]);

  const user0EditorGrants = await adapter.findObjects({
    type: "user",
    id: "user-0",
  }, "editor");
  assertEquals(user0EditorGrants.length, 1);
  assertEquals(user0EditorGrants[0].id, "admin");

  // hasTuple: exact subject+relation+object — must not match a near-miss
  // (right subject/object, wrong relation; right subject/relation, wrong object).
  assertStrictEquals(
    await adapter.hasTuple({ type: "user", id: "user-3" }, "member", {
      type: "group",
      id: "odd",
    }),
    true,
  );
  assertStrictEquals(
    await adapter.hasTuple({ type: "user", id: "user-3" }, "editor", {
      type: "group",
      id: "odd",
    }),
    false,
  );
  assertStrictEquals(
    await adapter.hasTuple({ type: "user", id: "user-3" }, "member", {
      type: "group",
      id: "even",
    }),
    false,
  );
});

Deno.test("AuthzLocalAdapter: findSubjects/findObjects narrow by subjectType/objectType option", async () => {
  const adapter = new AuthzLocalAdapter({
    storage: makeStorage(),
    dataDir: "data",
  });
  // Same object+relation, two different subject types — the schema only
  // declares "user" as a subject type in practice, but the adapter itself
  // is type-agnostic, so this exercises the options.subjectType filter path
  // for real rather than trivially (it would always pass with one type).
  await adapter.write([{
    subject: { type: "user", id: "alice" },
    relation: "member",
    object: { type: "group", id: "team" },
  }]);
  await adapter.write([{
    subject: { type: "service-account", id: "ci-bot" },
    relation: "member",
    object: { type: "group", id: "team" },
  }]);

  const allMembers = await adapter.findSubjects(
    { type: "group", id: "team" },
    "member",
  );
  assertEquals(allMembers.length, 2);

  const onlyUsers = await adapter.findSubjects(
    { type: "group", id: "team" },
    "member",
    { subjectType: "user" },
  );
  assertEquals(onlyUsers.length, 1);
  assertEquals(onlyUsers[0].id, "alice");
});

Deno.test("AuthzLocalAdapter: indexes reflect deletes — no stale results after removal", async () => {
  const adapter = new AuthzLocalAdapter({
    storage: makeStorage(),
    dataDir: "data",
  });
  await adapter.write([{
    subject: { type: "user", id: "frank" },
    relation: "member",
    object: { type: "group", id: "team" },
  }]);
  await adapter.write([{
    subject: { type: "user", id: "grace" },
    relation: "member",
    object: { type: "group", id: "team" },
  }]);

  assertEquals(
    (await adapter.findSubjects({ type: "group", id: "team" }, "member"))
      .length,
    2,
  );

  await adapter.delete({ who: { type: "user", id: "frank" } });

  const remaining = await adapter.findSubjects(
    { type: "group", id: "team" },
    "member",
  );
  assertEquals(remaining.length, 1);
  assertEquals(remaining[0].id, "grace");
  assertStrictEquals(
    await adapter.hasTuple({ type: "user", id: "frank" }, "member", {
      type: "group",
      id: "team",
    }),
    false,
  );

  // Delete the last tuple for this key too — the underlying index Map entry
  // should be cleaned up (not just left as an empty Set), but that's an
  // internal detail; what's observable and what matters is that the query
  // still correctly returns empty rather than erroring or returning stale data.
  await adapter.delete({ who: { type: "user", id: "grace" } });
  assertEquals(
    (await adapter.findSubjects({ type: "group", id: "team" }, "member"))
      .length,
    0,
  );
});

Deno.test("AuthzLocalAdapter: indexes are rebuilt correctly when reloaded from disk", async () => {
  const storage = makeStorage();
  const first = new AuthzLocalAdapter({ storage, dataDir: "data" });
  await first.write([{
    subject: { type: "user", id: "henry" },
    relation: "member",
    object: { type: "group", id: "team" },
  }]);
  await first.write([{
    subject: { type: "user", id: "henry" },
    relation: "editor",
    object: { type: "app", id: "admin" },
  }]);

  // A fresh adapter instance over the same storage — forces the ensureLoaded()
  // disk-scan path to build the indexes, not write()'s live-update path.
  // This is the path that was NOT covered by the write()-only tests above,
  // and is exactly where a bug (indexing only in write(), forgetting the
  // load path) would hide.
  const second = new AuthzLocalAdapter({ storage, dataDir: "data" });
  const members = await second.findSubjects(
    { type: "group", id: "team" },
    "member",
  );
  assertEquals(members.length, 1);
  assertEquals(members[0].id, "henry");

  assertStrictEquals(
    await second.hasTuple({ type: "user", id: "henry" }, "editor", {
      type: "app",
      id: "admin",
    }),
    true,
  );
  assertStrictEquals(
    await second.hasTuple({ type: "user", id: "henry" }, "member", {
      type: "app",
      id: "admin",
    }),
    false,
  );
});

// ── Strict HMAC mode (L-1) ────────────────────────────────────────────────────

async function makeHmacKey(): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode("test-authz-hmac-secret-at-least-32-bytes!"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

Deno.test("AuthzLocalAdapter: strict HMAC rejects unsigned tuples, accepts signed (L-1)", async () => {
  const { signTuple } = await import("../../src/auth/authz-hmac.ts");
  const key = await makeHmacKey();
  const storage = makeStorage();

  // Unsigned tuple — written directly to disk, as if hmac was stripped.
  const unsigned = {
    id: "t-unsigned",
    subject: { type: "user", id: "mallory" },
    relation: "member",
    object: { type: "group", id: "admins" },
  };
  await storage.write(
    "data/permissions/t-unsigned.json",
    JSON.stringify(unsigned),
  );

  // Properly signed tuple.
  const signedBase = {
    id: "t-signed",
    subject: { type: "user", id: "alice" },
    relation: "member",
    object: { type: "group", id: "admins" },
  };
  const hmac = await signTuple(signedBase, key);
  await storage.write(
    "data/permissions/t-signed.json",
    JSON.stringify({ ...signedBase, hmac }),
  );

  // Strict mode: unsigned tuple is NOT loaded, signed one is.
  const strict = new AuthzLocalAdapter({
    storage,
    dataDir: "data",
    hmacKey: key,
    strictHmac: true,
  });
  assertStrictEquals(
    await strict.hasTuple({ type: "user", id: "mallory" }, "member", {
      type: "group",
      id: "admins",
    }),
    false,
  );
  assertStrictEquals(
    await strict.hasTuple({ type: "user", id: "alice" }, "member", {
      type: "group",
      id: "admins",
    }),
    true,
  );

  // Migration (non-strict) mode: unsigned tuple is still accepted.
  const lenient = new AuthzLocalAdapter({
    storage,
    dataDir: "data",
    hmacKey: key,
    strictHmac: false,
  });
  assertStrictEquals(
    await lenient.hasTuple({ type: "user", id: "mallory" }, "member", {
      type: "group",
      id: "admins",
    }),
    true,
  );
});

// ── AuthSystem round-trip ─────────────────────────────────────────────────────

Deno.test("AuthSystem: addMember then check returns true", async () => {
  const storage = makeStorage();
  const { authz } = createDuneAuthSystem({ dataDir: "data" }, storage);
  await authz.addMember({
    member: { type: "user", id: "alice" },
    group: { type: "group", id: "member" },
  });
  const ok = await authz.check({
    who: { type: "user", id: "alice" },
    canThey: "access",
    onWhat: { type: "group", id: "member" },
  });
  assertStrictEquals(ok, true);
});

Deno.test("AuthSystem: check returns false for non-member", async () => {
  const storage = makeStorage();
  const { authz } = createDuneAuthSystem({ dataDir: "data" }, storage);
  const ok = await authz.check({
    who: { type: "user", id: "bob" },
    canThey: "access",
    onWhat: { type: "group", id: "member" },
  });
  assertStrictEquals(ok, false);
});

Deno.test("AuthSystem: allow then check edit action", async () => {
  const storage = makeStorage();
  const { authz } = createDuneAuthSystem({ dataDir: "data" }, storage);
  await authz.allow({
    who: { type: "user", id: "carol" },
    toBe: "owner",
    onWhat: { type: "resource", id: "/blog/my-post" },
  });
  const ok = await authz.check({
    who: { type: "user", id: "carol" },
    canThey: "edit",
    onWhat: { type: "resource", id: "/blog/my-post" },
  });
  assertStrictEquals(ok, true);
});

// ── bootstrapRoleTuples ───────────────────────────────────────────────────────

Deno.test("bootstrapRoleTuples: creates tuples from user roles", async () => {
  const storage = makeStorage();
  const { authz, adapter } = createDuneAuthSystem({ dataDir: "data" }, storage);

  await bootstrapRoleTuples(authz, adapter, [
    { id: "u1", roles: ["member", "premium"] },
    { id: "u2", roles: ["member"] },
  ]);

  assertStrictEquals(
    await authz.check({
      who: { type: "user", id: "u1" },
      canThey: "access",
      onWhat: { type: "group", id: "member" },
    }),
    true,
  );
  assertStrictEquals(
    await authz.check({
      who: { type: "user", id: "u1" },
      canThey: "access",
      onWhat: { type: "group", id: "premium" },
    }),
    true,
  );
  assertStrictEquals(
    await authz.check({
      who: { type: "user", id: "u2" },
      canThey: "access",
      onWhat: { type: "group", id: "member" },
    }),
    true,
  );
  assertStrictEquals(
    await authz.check({
      who: { type: "user", id: "u2" },
      canThey: "access",
      onWhat: { type: "group", id: "premium" },
    }),
    false,
  );
});

Deno.test("bootstrapRoleTuples: idempotent — does not duplicate tuples", async () => {
  const storage = makeStorage();
  const { authz, adapter } = createDuneAuthSystem({ dataDir: "data" }, storage);
  const users = [{ id: "u1", roles: ["member"] }];

  await bootstrapRoleTuples(authz, adapter, users);
  await bootstrapRoleTuples(authz, adapter, users);

  const tuples = await adapter.findTuples({
    subject: { type: "user", id: "u1" },
  });
  assertEquals(tuples.length, 1);
});

// ── bootstrapAdminTuples ──────────────────────────────────────────────────────

Deno.test("bootstrapAdminTuples: grants admin access via 'access' action", async () => {
  const storage = makeStorage();
  const { authz, adapter } = createDuneAuthSystem({ dataDir: "data" }, storage);

  await bootstrapAdminTuples(authz, adapter, [
    { id: "admin-1", role: "admin" },
    { id: "editor-1", role: "editor" },
    { id: "author-1", role: "author" },
  ]);

  assertStrictEquals(
    await authz.check({
      who: { type: "user", id: "admin-1" },
      canThey: "access",
      onWhat: { type: "app", id: "admin" },
    }),
    true,
  );
  assertStrictEquals(
    await authz.check({
      who: { type: "user", id: "editor-1" },
      canThey: "access",
      onWhat: { type: "app", id: "admin" },
    }),
    true,
  );
  assertStrictEquals(
    await authz.check({
      who: { type: "user", id: "author-1" },
      canThey: "access",
      onWhat: { type: "app", id: "admin" },
    }),
    true,
  );
});

Deno.test("bootstrapAdminTuples: admin has users.manage, editor does not", async () => {
  const storage = makeStorage();
  const { authz, adapter } = createDuneAuthSystem({ dataDir: "data" }, storage);

  await bootstrapAdminTuples(authz, adapter, [
    { id: "admin-1", role: "admin" },
    { id: "editor-1", role: "editor" },
  ]);

  assertStrictEquals(
    await authz.check({
      who: { type: "user", id: "admin-1" },
      canThey: "users.manage",
      onWhat: { type: "app", id: "admin" },
    }),
    true,
  );
  assertStrictEquals(
    await authz.check({
      who: { type: "user", id: "editor-1" },
      canThey: "users.manage",
      onWhat: { type: "app", id: "admin" },
    }),
    false,
  );
});

Deno.test("bootstrapAdminTuples: idempotent — does not duplicate tuples", async () => {
  const storage = makeStorage();
  const { authz, adapter } = createDuneAuthSystem({ dataDir: "data" }, storage);
  const adminUsers = [{ id: "admin-1", role: "admin" }];

  await bootstrapAdminTuples(authz, adapter, adminUsers);
  await bootstrapAdminTuples(authz, adapter, adminUsers);

  const tuples = await adapter.findTuples({
    subject: { type: "user", id: "admin-1" },
  });
  assertEquals(tuples.length, 1);
});

Deno.test("bootstrapAdminTuples: unknown user has no admin access", async () => {
  const storage = makeStorage();
  const { authz, adapter } = createDuneAuthSystem({ dataDir: "data" }, storage);

  await bootstrapAdminTuples(authz, adapter, [{
    id: "admin-1",
    role: "admin",
  }]);

  assertStrictEquals(
    await authz.check({
      who: { type: "user", id: "nobody" },
      canThey: "access",
      onWhat: { type: "app", id: "admin" },
    }),
    false,
  );
});

// ── checkRolesAsync with live authz ──────────────────────────────────────────

Deno.test("checkRolesAsync: uses authz when wired — member granted", async () => {
  const storage = makeStorage();
  const { authz } = createDuneAuthSystem({ dataDir: "data" }, storage);
  setGatingAuthz(authz);
  try {
    await authz.addMember({
      member: { type: "user", id: "user-a" },
      group: { type: "group", id: "member" },
    });
    const user = makeUser("user-a", []); // no roles[] — authz is the authority
    const ok = await checkRolesAsync(user, "member");
    assertStrictEquals(ok, true);
  } finally {
    setGatingAuthz(null); // clean up module state
  }
});

Deno.test("checkRolesAsync: uses authz when wired — non-member denied", async () => {
  const storage = makeStorage();
  const { authz } = createDuneAuthSystem({ dataDir: "data" }, storage);
  setGatingAuthz(authz);
  try {
    const user = makeUser("user-b", ["member"]); // roles[] present but authz says no
    const ok = await checkRolesAsync(user, "member");
    assertStrictEquals(ok, false); // authz has no tuple for user-b
  } finally {
    setGatingAuthz(null);
  }
});

Deno.test("checkRolesAsync: falls back to array check when no authz", async () => {
  setGatingAuthz(null);
  const user = makeUser("user-c", ["member"]);
  const ok = await checkRolesAsync(user, "member");
  assertStrictEquals(ok, true);
});

Deno.test("checkRolesAsync: null user → denied regardless of authz", async () => {
  const storage = makeStorage();
  const { authz } = createDuneAuthSystem({ dataDir: "data" }, storage);
  setGatingAuthz(authz);
  try {
    const ok = await checkRolesAsync(null, "member");
    assertStrictEquals(ok, false);
  } finally {
    setGatingAuthz(null);
  }
});

Deno.test("checkRolesAsync: empty array spec → any authenticated user (no authz call)", async () => {
  const storage = makeStorage();
  const { authz } = createDuneAuthSystem({ dataDir: "data" }, storage);
  setGatingAuthz(authz);
  try {
    const user = makeUser("user-d", []); // no roles at all
    const ok = await checkRolesAsync(user, []);
    assertStrictEquals(ok, true);
  } finally {
    setGatingAuthz(null);
  }
});

// ── external-jwt lazy provisioning via bootstrapRoleTuples ───────────────────
// In external-jwt + authzStore:local mode, mountDuneAuth() calls
// bootstrapRoleTuples(authz, adapter, [user]) on first appearance. These tests
// verify that pattern works correctly for a single user.

Deno.test("external-jwt provisioning: JWT roles seed group membership tuples", async () => {
  const storage = makeStorage();
  const { authz, adapter } = createDuneAuthSystem({ dataDir: "data" }, storage);

  const user = makeUser("ext-user-1", ["member", "premium"]);
  await bootstrapRoleTuples(authz, adapter, [user]);

  assertStrictEquals(
    await authz.check({
      who: { type: "user", id: "ext-user-1" },
      canThey: "access",
      onWhat: { type: "group", id: "member" },
    }),
    true,
  );
  assertStrictEquals(
    await authz.check({
      who: { type: "user", id: "ext-user-1" },
      canThey: "access",
      onWhat: { type: "group", id: "premium" },
    }),
    true,
  );
});

Deno.test("external-jwt provisioning: user with no JWT roles gets no tuples", async () => {
  const storage = makeStorage();
  const { authz, adapter } = createDuneAuthSystem({ dataDir: "data" }, storage);

  const user = makeUser("ext-user-2", []);
  await bootstrapRoleTuples(authz, adapter, [user]);

  assertStrictEquals(
    await authz.check({
      who: { type: "user", id: "ext-user-2" },
      canThey: "access",
      onWhat: { type: "group", id: "member" },
    }),
    false,
  );
});

Deno.test("external-jwt provisioning: repeated calls are idempotent (no duplicate tuples)", async () => {
  const storage = makeStorage();
  const { authz, adapter } = createDuneAuthSystem({ dataDir: "data" }, storage);

  const user = makeUser("ext-user-3", ["member"]);
  // Simulate multiple requests before the in-process set guards kick in
  await bootstrapRoleTuples(authz, adapter, [user]);
  await bootstrapRoleTuples(authz, adapter, [user]);
  await bootstrapRoleTuples(authz, adapter, [user]);

  const tuples = await adapter.findTuples({
    subject: { type: "user", id: "ext-user-3" },
  });
  assertEquals(tuples.length, 1);
});

Deno.test("external-jwt provisioning: gating uses authz.check() — not roles[] — when authz wired", async () => {
  const storage = makeStorage();
  const { authz, adapter } = createDuneAuthSystem({ dataDir: "data" }, storage);
  setGatingAuthz(authz);
  try {
    // User's JWT says "member" but no tuple has been provisioned yet
    const unprovisioned = makeUser("ext-user-4", ["member"]);
    assertStrictEquals(await checkRolesAsync(unprovisioned, "member"), false);

    // After lazy provisioning, the tuple exists and check passes
    await bootstrapRoleTuples(authz, adapter, [unprovisioned]);
    assertStrictEquals(await checkRolesAsync(unprovisioned, "member"), true);
  } finally {
    setGatingAuthz(null);
  }
});

Deno.test("external-jwt provisioning: a different user's tuples don't affect another", async () => {
  const storage = makeStorage();
  const { authz, adapter } = createDuneAuthSystem({ dataDir: "data" }, storage);

  await bootstrapRoleTuples(authz, adapter, [
    makeUser("ext-user-5", ["member"]),
  ]);

  assertStrictEquals(
    await authz.check({
      who: { type: "user", id: "ext-user-6" },
      canThey: "access",
      onWhat: { type: "group", id: "member" },
    }),
    false,
  );
});
