/**
 * Tests for `dune users:create` — the admin-provisioned-account CLI
 * command. Creates a User record directly, before the person has ever
 * logged in; their first real magic-link login matches it by email.
 */

import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { usersCreateCommand } from "../../src/cli/users-create.ts";
import { createLocalUserStore } from "../../src/auth/user-store.ts";
import { createStorage } from "../../src/storage/mod.ts";
import { AuthzLocalAdapter } from "../../src/auth/authz-adapter-local.ts";

async function withTempSite(
  fn: (root: string) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "dune_test_users_create_" });
  try {
    await fn(root);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

function userStoreFor(root: string) {
  return createLocalUserStore({
    storage: createStorage({ rootDir: root }),
    usersDir: "data/users",
  });
}

/** True if a { type:"user", id } --relation--> { type:"app", id:"admin" } tuple exists on disk. */
async function hasAdminTuple(
  root: string,
  userId: string,
  relation: string,
): Promise<boolean> {
  const storage = createStorage({ rootDir: root });
  const adapter = new AuthzLocalAdapter({ storage, dataDir: "data" });
  return await adapter.hasTuple(
    { type: "user", id: userId },
    relation,
    { type: "app", id: "admin" },
  );
}

function withMockedExit(fn: () => Promise<void>): Promise<number | undefined> {
  const origExit = Deno.exit;
  let exitCode: number | undefined;
  // deno-lint-ignore no-explicit-any
  (Deno as any).exit = (code?: number) => {
    exitCode = code;
    throw new Error(`exit:${code}`);
  };
  return fn()
    .catch(() => {/* expected when exit() is hit */})
    .then(() => exitCode)
    .finally(() => {
      Deno.exit = origExit;
    });
}

Deno.test("users:create creates a user with provider 'invited' and no roles by default", async () => {
  await withTempSite(async (root) => {
    await usersCreateCommand(root, "alice@example.com", {});

    const user = await userStoreFor(root).getByEmail("alice@example.com");
    assertExists(user);
    assertEquals(user!.provider, "invited");
    assertEquals(user!.roles, []);
  });
});

Deno.test("users:create normalizes the email to lowercase", async () => {
  await withTempSite(async (root) => {
    await usersCreateCommand(root, "Alice@Example.COM", {});

    const user = await userStoreFor(root).getByEmail("alice@example.com");
    assertExists(user);
    assertEquals(user!.email, "alice@example.com");
  });
});

Deno.test("users:create sets the display name when given", async () => {
  await withTempSite(async (root) => {
    await usersCreateCommand(root, "alice@example.com", { name: "Alice" });

    const user = await userStoreFor(root).getByEmail("alice@example.com");
    assertEquals(user!.name, "Alice");
  });
});

Deno.test("users:create sets arbitrary (non-admin-tier) role tags, no authz tuple", async () => {
  await withTempSite(async (root) => {
    await usersCreateCommand(root, "alice@example.com", {
      roles: ["beta-tester"],
    });

    const user = await userStoreFor(root).getByEmail("alice@example.com");
    assertEquals(user!.roles, ["beta-tester"]);
    assertEquals(await hasAdminTuple(root, user!.id, "editor"), false);
  });
});

Deno.test("users:create syncs the app:admin authz tuple for an admin-tier role", async () => {
  await withTempSite(async (root) => {
    await usersCreateCommand(root, "alice@example.com", {
      roles: ["editor"],
    });

    const user = await userStoreFor(root).getByEmail("alice@example.com");
    assertEquals(await hasAdminTuple(root, user!.id, "editor"), true);
  });
});

Deno.test("users:create with mixed roles keeps all tags and syncs only the admin-tier one", async () => {
  await withTempSite(async (root) => {
    await usersCreateCommand(root, "alice@example.com", {
      roles: ["beta-tester", "admin"],
    });

    const user = await userStoreFor(root).getByEmail("alice@example.com");
    assertEquals(user!.roles?.sort(), ["admin", "beta-tester"]);
    assertEquals(await hasAdminTuple(root, user!.id, "admin"), true);
  });
});

Deno.test("users:create exits 1 for an invalid email", async () => {
  await withTempSite(async (root) => {
    const exitCode = await withMockedExit(() =>
      usersCreateCommand(root, "not-an-email", {})
    );
    assertEquals(exitCode, 1);
  });
});

Deno.test("users:create exits 1 when the email already exists", async () => {
  await withTempSite(async (root) => {
    await usersCreateCommand(root, "alice@example.com", {});

    const exitCode = await withMockedExit(() =>
      usersCreateCommand(root, "alice@example.com", {})
    );
    assertEquals(exitCode, 1);
  });
});

Deno.test("users:create --dry-run makes no changes", async () => {
  await withTempSite(async (root) => {
    await usersCreateCommand(root, "alice@example.com", {
      roles: ["editor"],
      dryRun: true,
    });

    const user = await userStoreFor(root).getByEmail("alice@example.com");
    assertEquals(user, null);
  });
});
