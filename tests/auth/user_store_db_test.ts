/**
 * Tests for DbUserStore (createDbUserStore) — the SQL-backed UserStore tier.
 * Exercised against an in-memory SQLite DbAdapter (the same one
 * tests/db/repository_test.ts uses); the store's own SQL is
 * driver-agnostic (same queries run against Postgres).
 *
 * No prior coverage existed for this tier at all before this file.
 */

import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { SQLiteAdapter } from "../../src/db/adapters/sqlite.ts";
import { createDbUserStore } from "../../src/auth/user-store-db.ts";
import { DuplicateEmailError } from "../../src/auth/user-store.ts";
import type { UserStore } from "../../src/auth/user-store.ts";

async function withStore(
  fn: (store: UserStore) => Promise<void>,
): Promise<void> {
  const adapter = await SQLiteAdapter.open(":memory:");
  try {
    const store = await createDbUserStore({ adapter });
    await fn(store);
  } finally {
    await adapter.close();
  }
}

Deno.test("DbUserStore: create and getById round-trip the full shape", async () => {
  await withStore(async (store) => {
    const user = await store.create({
      email: "alice@example.com",
      name: "Alice",
      avatarUrl: "https://example.com/a.png",
      username: "alice",
      passwordHash: "hash",
      provider: "local",
      providerId: "p1",
      roles: ["admin"],
      stripeCustomerId: "cus_123",
    });

    assertEquals(user.email, "alice@example.com");
    assertEquals(user.roles, ["admin"]);
    assertEquals(typeof user.id, "string");
    assertEquals(user.updatedAt, user.createdAt);
    assertEquals(user.enabled, true);

    const fetched = await store.getById(user.id);
    assertEquals(fetched, user);
  });
});

Deno.test("DbUserStore: getByEmail finds a created user", async () => {
  await withStore(async (store) => {
    const user = await store.create({
      email: "bob@example.com",
      provider: "magic",
      roles: [],
    });
    const found = await store.getByEmail("bob@example.com");
    assertEquals(found?.id, user.id);
  });
});

Deno.test("DbUserStore: getByUsername finds a created user", async () => {
  await withStore(async (store) => {
    const user = await store.create({
      email: "carol@example.com",
      username: "carol",
      provider: "local",
      roles: ["editor"],
    });
    const found = await store.getByUsername("carol");
    assertEquals(found?.id, user.id);
  });
});

Deno.test("DbUserStore: getByProvider finds a created user", async () => {
  await withStore(async (store) => {
    const user = await store.create({
      email: "dave@example.com",
      provider: "github",
      providerId: "gh-1",
      roles: [],
    });
    const found = await store.getByProvider("github", "gh-1");
    assertEquals(found?.id, user.id);
    assertEquals(await store.getByProvider("google", "gh-1"), null);
  });
});

Deno.test("DbUserStore: linkProvider adds a linked entry, findable via getByProvider", async () => {
  await withStore(async (store) => {
    const user = await store.create({
      email: "erin@example.com",
      provider: "magic",
      roles: [],
    });

    const updated = await store.linkProvider(user.id, "github", "gh-erin");
    assertEquals(updated?.linkedProviders, [{ provider: "github", providerId: "gh-erin" }]);

    const found = await store.getByProvider("github", "gh-erin");
    assertEquals(found?.id, user.id);
  });
});

Deno.test("DbUserStore: linkProvider is a no-op when already linked or already primary", async () => {
  await withStore(async (store) => {
    const user = await store.create({
      email: "farid@example.com",
      provider: "github",
      providerId: "gh-farid",
      roles: [],
    });

    const same = await store.linkProvider(user.id, "github", "gh-farid");
    assertEquals(same?.linkedProviders ?? [], []);

    await store.linkProvider(user.id, "google", "gg-farid");
    const again = await store.linkProvider(user.id, "google", "gg-farid");
    assertEquals(again?.linkedProviders, [{ provider: "google", providerId: "gg-farid" }]);
  });
});

Deno.test("DbUserStore: unlinkProvider removes a linked entry", async () => {
  await withStore(async (store) => {
    const user = await store.create({
      email: "gina@example.com",
      provider: "magic",
      roles: [],
    });
    await store.linkProvider(user.id, "github", "gh-gina");
    await store.linkProvider(user.id, "google", "gg-gina");

    const updated = await store.unlinkProvider(user.id, "github");
    assertEquals(updated?.linkedProviders, [{ provider: "google", providerId: "gg-gina" }]);
    assertEquals(await store.getByProvider("github", "gh-gina"), null);
    assertEquals((await store.getByProvider("google", "gg-gina"))?.id, user.id);
  });
});

Deno.test("DbUserStore: create() throws DuplicateEmailError for an already-used email", async () => {
  await withStore(async (store) => {
    await store.create({
      email: "dup@example.com",
      provider: "magic",
      roles: [],
    });
    await assertRejects(
      () =>
        store.create({
          email: "dup@example.com",
          provider: "magic",
          roles: [],
        }),
      DuplicateEmailError,
    );
  });
});

Deno.test("DbUserStore: update() throws DuplicateEmailError when changing to another user's email", async () => {
  await withStore(async (store) => {
    await store.create({
      email: "taken@example.com",
      provider: "magic",
      roles: [],
    });
    const user2 = await store.create({
      email: "available@example.com",
      provider: "magic",
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
});

Deno.test("DbUserStore: update() can change email to an unused address", async () => {
  await withStore(async (store) => {
    const user = await store.create({
      email: "old@example.com",
      provider: "magic",
      roles: [],
    });
    const updated = await store.update(user.id, { email: "new@example.com" });

    assertEquals(updated?.email, "new@example.com");
    assertEquals(await store.getByEmail("new@example.com"), updated);
    assertEquals(await store.getByEmail("old@example.com"), null);
  });
});

Deno.test("DbUserStore: update() bumps updatedAt", async () => {
  await withStore(async (store) => {
    const user = await store.create({
      email: "eve@example.com",
      provider: "magic",
      roles: [],
    });
    await new Promise((r) => setTimeout(r, 5));
    const updated = await store.update(user.id, { name: "Eve" });

    assertEquals(updated?.name, "Eve");
    assertEquals((updated?.updatedAt ?? 0) > user.updatedAt, true);
  });
});

Deno.test("DbUserStore: update() modifies roles, enabled, and other fields", async () => {
  await withStore(async (store) => {
    const user = await store.create({
      email: "frank@example.com",
      provider: "magic",
      roles: [],
    });
    const updated = await store.update(user.id, {
      roles: ["subscriber"],
      enabled: false,
      avatarUrl: "https://example.com/f.png",
      stripeCustomerId: "cus_456",
    });

    assertEquals(updated?.roles, ["subscriber"]);
    assertEquals(updated?.enabled, false);
    assertEquals(updated?.avatarUrl, "https://example.com/f.png");
    assertEquals(updated?.stripeCustomerId, "cus_456");
  });
});

Deno.test("DbUserStore: update() returns null for a missing user", async () => {
  await withStore(async (store) => {
    const result = await store.update("nonexistent", { name: "Nobody" });
    assertEquals(result, null);
  });
});

Deno.test("DbUserStore: delete removes a user", async () => {
  await withStore(async (store) => {
    const user = await store.create({
      email: "grace@example.com",
      provider: "magic",
      roles: [],
    });
    const deleted = await store.delete(user.id);
    assertEquals(deleted, true);
    assertEquals(await store.getById(user.id), null);
  });
});

Deno.test("DbUserStore: list returns all users sorted by createdAt, respects limit/offset", async () => {
  await withStore(async (store) => {
    const a = await store.create({
      email: "a@example.com",
      provider: "magic",
      roles: [],
    });
    await new Promise((r) => setTimeout(r, 2));
    const b = await store.create({
      email: "b@example.com",
      provider: "magic",
      roles: [],
    });
    await new Promise((r) => setTimeout(r, 2));
    const c = await store.create({
      email: "c@example.com",
      provider: "magic",
      roles: [],
    });

    const all = await store.list();
    assertEquals(all.map((u) => u.id), [a.id, b.id, c.id]);

    const limited = await store.list({ limit: 2 });
    assertEquals(limited.map((u) => u.id), [a.id, b.id]);

    const offset = await store.list({ offset: 1 });
    assertEquals(offset.map((u) => u.id), [b.id, c.id]);
  });
});

Deno.test("DbUserStore: create() defaults roles to [] and enabled to true", async () => {
  await withStore(async (store) => {
    const user = await store.create(
      { email: "default@example.com", provider: "magic" } as never,
    );
    assertEquals(user.roles, []);
    assertEquals(user.enabled, true);
  });
});

Deno.test("DbUserStore: create() respects enabled: false", async () => {
  await withStore(async (store) => {
    const user = await store.create({
      email: "disabled@example.com",
      provider: "magic",
      roles: [],
      enabled: false,
    });
    assertEquals(user.enabled, false);
  });
});
