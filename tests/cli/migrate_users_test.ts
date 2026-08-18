/**
 * Tests for `dune migrate:users` — reshapes pre-Phase-5b data/users/*.json
 * admin accounts (single `role` field) into the current User shape
 * (`roles: string[]`, `provider`, `lastSeenAt`) and builds the by-email
 * index that never existed for admin accounts before the Phase 5b cutover.
 */

import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { join } from "@std/path";
import { migrateUsersCommand } from "../../src/cli/migrate-users.ts";

async function withTempSite(
  fn: (root: string) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "dune_test_migrate_users_" });
  try {
    await fn(root);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

async function writeUser(
  root: string,
  filename: string,
  data: Record<string, unknown>,
): Promise<void> {
  const usersDir = join(root, "data", "users");
  await Deno.mkdir(usersDir, { recursive: true });
  await Deno.writeTextFile(
    join(usersDir, filename),
    JSON.stringify(data, null, 2),
  );
}

async function readUser(
  root: string,
  filename: string,
): Promise<Record<string, unknown>> {
  const raw = await Deno.readTextFile(join(root, "data", "users", filename));
  return JSON.parse(raw);
}

async function indexExists(root: string, email: string): Promise<boolean> {
  const path = join(
    root,
    "data",
    "users",
    "by-email",
    `${encodeURIComponent(email.toLowerCase())}.json`,
  );
  return await Deno.stat(path).then(() => true).catch(() => false);
}

Deno.test("migrate:users: reshapes an old-shape record (role -> roles)", async () => {
  await withTempSite(async (root) => {
    await writeUser(root, "u1.json", {
      id: "u1",
      username: "alice",
      email: "alice@example.com",
      passwordHash: "hash",
      role: "admin",
      name: "Alice",
      createdAt: 1000,
      updatedAt: 1000,
      enabled: true,
    });

    await migrateUsersCommand(root, {});

    const user = await readUser(root, "u1.json");
    assertEquals(user.role, undefined);
    assertEquals(user.roles, ["admin"]);
    assertEquals(user.provider, "local");
    assertEquals(user.lastSeenAt, 1000);
    // Existing fields untouched
    assertEquals(user.username, "alice");
    assertEquals(user.passwordHash, "hash");
  });
});

Deno.test("migrate:users: builds the by-email index for a reshaped record", async () => {
  await withTempSite(async (root) => {
    await writeUser(root, "u1.json", {
      id: "u1",
      username: "alice",
      email: "alice@example.com",
      passwordHash: "hash",
      role: "admin",
      name: "Alice",
      createdAt: 1000,
      updatedAt: 1000,
      enabled: true,
    });

    await migrateUsersCommand(root, {});

    assertEquals(await indexExists(root, "alice@example.com"), true);
    const indexRaw = await Deno.readTextFile(
      join(
        root,
        "data",
        "users",
        "by-email",
        `${encodeURIComponent("alice@example.com")}.json`,
      ),
    );
    assertEquals(JSON.parse(indexRaw), { id: "u1" });
  });
});

Deno.test("migrate:users: is idempotent — a second run leaves an already-migrated record unchanged", async () => {
  await withTempSite(async (root) => {
    await writeUser(root, "u1.json", {
      id: "u1",
      username: "alice",
      email: "alice@example.com",
      passwordHash: "hash",
      role: "admin",
      name: "Alice",
      createdAt: 1000,
      updatedAt: 1000,
      enabled: true,
    });

    await migrateUsersCommand(root, {});
    const afterFirst = await readUser(root, "u1.json");

    await migrateUsersCommand(root, {});
    const afterSecond = await readUser(root, "u1.json");

    assertEquals(afterSecond, afterFirst);
  });
});

Deno.test("migrate:users: --dry-run reshapes nothing and builds no index", async () => {
  await withTempSite(async (root) => {
    await writeUser(root, "u1.json", {
      id: "u1",
      username: "alice",
      email: "alice@example.com",
      passwordHash: "hash",
      role: "admin",
      name: "Alice",
      createdAt: 1000,
      updatedAt: 1000,
      enabled: true,
    });

    await migrateUsersCommand(root, { dryRun: true });

    const user = await readUser(root, "u1.json");
    assertEquals(user.role, "admin");
    assertEquals(user.roles, undefined);
    assertEquals(await indexExists(root, "alice@example.com"), false);
  });
});

Deno.test("migrate:users: a record already in the current shape is left alone, only the index is built", async () => {
  await withTempSite(async (root) => {
    await writeUser(root, "u1.json", {
      id: "u1",
      username: "bob",
      email: "bob@example.com",
      passwordHash: "hash",
      provider: "local",
      roles: ["editor"],
      name: "Bob",
      createdAt: 1000,
      updatedAt: 1000,
      lastSeenAt: 1000,
      enabled: true,
    });

    await migrateUsersCommand(root, {});

    const user = await readUser(root, "u1.json");
    assertEquals(user.roles, ["editor"]);
    assertEquals(await indexExists(root, "bob@example.com"), true);
  });
});

Deno.test("migrate:users: two accounts sharing an email both get reshaped, only the first (by filename) gets the index entry", async () => {
  await withTempSite(async (root) => {
    await writeUser(root, "a-first.json", {
      id: "dup-1",
      username: "dup1",
      email: "dup@example.com",
      passwordHash: "hash",
      role: "admin",
      name: "Dup One",
      createdAt: 1000,
      updatedAt: 1000,
      enabled: true,
    });
    await writeUser(root, "b-second.json", {
      id: "dup-2",
      username: "dup2",
      email: "dup@example.com",
      passwordHash: "hash",
      role: "editor",
      name: "Dup Two",
      createdAt: 2000,
      updatedAt: 2000,
      enabled: true,
    });

    await migrateUsersCommand(root, {});

    const first = await readUser(root, "a-first.json");
    const second = await readUser(root, "b-second.json");
    assertEquals(first.roles, ["admin"]);
    assertEquals(second.roles, ["editor"]);

    const indexRaw = await Deno.readTextFile(
      join(
        root,
        "data",
        "users",
        "by-email",
        `${encodeURIComponent("dup@example.com")}.json`,
      ),
    );
    assertEquals(JSON.parse(indexRaw), { id: "dup-1" });
  });
});

Deno.test("migrate:users: no data/users directory — reports nothing to migrate, does not throw", async () => {
  await withTempSite(async (root) => {
    await migrateUsersCommand(root, {});
    // No assertion needed beyond "did not throw" — covered by the test running to completion.
  });
});

Deno.test("migrate:users: skips a corrupt JSON file without throwing, still migrates the rest", async () => {
  await withTempSite(async (root) => {
    const usersDir = join(root, "data", "users");
    await Deno.mkdir(usersDir, { recursive: true });
    await Deno.writeTextFile(
      join(usersDir, "corrupt.json"),
      "{ not valid json",
    );
    await writeUser(root, "u1.json", {
      id: "u1",
      username: "alice",
      email: "alice@example.com",
      passwordHash: "hash",
      role: "admin",
      name: "Alice",
      createdAt: 1000,
      updatedAt: 1000,
      enabled: true,
    });

    await migrateUsersCommand(root, {});

    const user = await readUser(root, "u1.json");
    assertEquals(user.roles, ["admin"]);
    assertExists(user);
  });
});
