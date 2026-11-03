import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ensureAdminFromEnv } from "../../src/auth/bootstrap-admin.ts";
import { verifyPassword } from "../../src/auth/passwords.ts";
import { createLocalUserStore } from "../../src/auth/user-store.ts";
import { createStorage } from "../../src/storage/mod.ts";

async function withStore(
  fn: (store: ReturnType<typeof createLocalUserStore>) => Promise<void>,
) {
  const root = await Deno.makeTempDir({ prefix: "dune_test_bootstrap_admin_" });
  try {
    await fn(
      createLocalUserStore({
        storage: createStorage({ rootDir: root }),
        usersDir: "data/users",
      }),
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

const envOf = (vars: Record<string, string>) => ({
  get: (k: string) => vars[k],
});
const GOOD = "a-long-enough-passphrase";

Deno.test("env bootstrap does nothing when not configured", async () => {
  await withStore(async (userStore) => {
    const r = await ensureAdminFromEnv({ userStore, env: envOf({}) });
    assertEquals(r, { created: false, reason: "not-configured" });
    assertEquals((await userStore.list()).length, 0);
  });
});

Deno.test("env bootstrap creates a local admin with a verifiable hash and calls onCreated", async () => {
  await withStore(async (userStore) => {
    let tupleFor: string | undefined;
    const r = await ensureAdminFromEnv({
      userStore,
      env: envOf({
        DUNE_ADMIN_EMAIL: "Boss@Example.com",
        DUNE_ADMIN_PASSWORD: GOOD,
      }),
      onCreated: (u) => {
        tupleFor = u.id;
        return Promise.resolve();
      },
    });
    assertEquals(r.created, true);
    const user = await userStore.getByEmail("boss@example.com");
    assertEquals(user!.username, "admin");
    assertEquals(user!.roles, ["admin"]);
    assertEquals(user!.provider, "local");
    assertEquals(await verifyPassword(GOOD, user!.passwordHash!), true);
    assertEquals(tupleFor, user!.id);
  });
});

Deno.test("env bootstrap honours DUNE_ADMIN_USERNAME", async () => {
  await withStore(async (userStore) => {
    await ensureAdminFromEnv({
      userStore,
      env: envOf({
        DUNE_ADMIN_EMAIL: "b@example.com",
        DUNE_ADMIN_PASSWORD: GOOD,
        DUNE_ADMIN_USERNAME: "chris",
      }),
    });
    assertEquals(
      (await userStore.getByUsername("chris"))!.email,
      "b@example.com",
    );
  });
});

Deno.test("env bootstrap never touches a site that already has an enabled admin", async () => {
  await withStore(async (userStore) => {
    const existing = await userStore.create({
      email: "old@example.com",
      username: "old",
      provider: "local",
      roles: ["admin"],
      passwordHash: "keep",
    });
    const r = await ensureAdminFromEnv({
      userStore,
      env: envOf({
        DUNE_ADMIN_EMAIL: "new@example.com",
        DUNE_ADMIN_PASSWORD: GOOD,
      }),
    });
    assertEquals(r, { created: false, reason: "admin-exists" });
    assertEquals((await userStore.getById(existing.id))!.passwordHash, "keep");
    assertEquals((await userStore.list()).length, 1);
  });
});

Deno.test("env bootstrap treats a disabled admin as no admin", async () => {
  await withStore(async (userStore) => {
    await userStore.create({
      email: "old@example.com",
      username: "old",
      provider: "local",
      roles: ["admin"],
      passwordHash: "x",
      enabled: false,
    });
    const r = await ensureAdminFromEnv({
      userStore,
      env: envOf({
        DUNE_ADMIN_EMAIL: "new@example.com",
        DUNE_ADMIN_PASSWORD: GOOD,
      }),
    });
    assertEquals(r.created, true);
  });
});

Deno.test("env bootstrap fails loudly on half-configured, weak, invalid or colliding input", async () => {
  await withStore(async (userStore) => {
    await assertRejects(
      () =>
        ensureAdminFromEnv({
          userStore,
          env: envOf({ DUNE_ADMIN_EMAIL: "a@example.com" }),
        }),
      Error,
      "must be set together",
    );
    await assertRejects(
      () =>
        ensureAdminFromEnv({
          userStore,
          env: envOf({ DUNE_ADMIN_PASSWORD: GOOD }),
        }),
      Error,
      "must be set together",
    );
    await assertRejects(
      () =>
        ensureAdminFromEnv({
          userStore,
          env: envOf({
            DUNE_ADMIN_EMAIL: "a@example.com",
            DUNE_ADMIN_PASSWORD: "short",
          }),
        }),
      Error,
      "DUNE_ADMIN_PASSWORD rejected",
    );
    await assertRejects(
      () =>
        ensureAdminFromEnv({
          userStore,
          env: envOf({ DUNE_ADMIN_EMAIL: "nope", DUNE_ADMIN_PASSWORD: GOOD }),
        }),
      Error,
      "not a valid email",
    );
    await userStore.create({
      email: "member@example.com",
      provider: "magic",
      roles: [],
    });
    await assertRejects(
      () =>
        ensureAdminFromEnv({
          userStore,
          env: envOf({
            DUNE_ADMIN_EMAIL: "member@example.com",
            DUNE_ADMIN_PASSWORD: GOOD,
          }),
        }),
      Error,
      "existing non-admin account",
    );
    assertEquals((await userStore.list()).length, 1);
  });
});
