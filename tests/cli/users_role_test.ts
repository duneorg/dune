/**
 * Tests for `dune users:grant-role` / `dune users:revoke-role` —
 * dec-identity-unification Phase 6's CLI leg for the role-granting
 * mechanism. Grants/revokes an admin-tier role on an existing unified User
 * (identified by email) and syncs the app:admin authz tuple
 * `authz.check()` reads at permission-check time.
 */

import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { join } from "@std/path";
import {
  grantRoleCommand,
  revokeRoleCommand,
} from "../../src/cli/users-role.ts";
import { createStorage } from "../../src/storage/mod.ts";
import { AuthzLocalAdapter } from "../../src/auth/authz-adapter-local.ts";

async function withTempSite(
  fn: (root: string) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "dune_test_users_role_" });
  try {
    await fn(root);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

/**
 * Writes a user record AND its by-email index entry — getByEmail() (the
 * lookup this CLI relies on) reads only the index, never scans
 * data/users/*.json directly, matching tests/cli/migrate_users_test.ts's
 * same fixture pattern.
 */
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

  const byEmailDir = join(usersDir, "by-email");
  await Deno.mkdir(byEmailDir, { recursive: true });
  const email = String(data.email).toLowerCase();
  await Deno.writeTextFile(
    join(byEmailDir, `${encodeURIComponent(email)}.json`),
    JSON.stringify({ id: data.id }),
  );
}

async function readUser(
  root: string,
  filename: string,
): Promise<Record<string, unknown>> {
  const raw = await Deno.readTextFile(join(root, "data", "users", filename));
  return JSON.parse(raw);
}

/** True if a { type:"user", id } --relation--> { type:"app", id:"admin" } tuple exists on disk. */
async function hasAdminTuple(
  root: string,
  userId: string,
  relation: string,
): Promise<boolean> {
  const storage = createStorage({ rootDir: root });
  // Relative to `storage`'s own rootDir — StorageAdapter rejects absolute
  // paths (this exact mismatch was the bug found while writing this file).
  const adapter = new AuthzLocalAdapter({
    storage,
    dataDir: "data",
  });
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

const baseUser = {
  id: "u1",
  username: "alice",
  email: "alice@example.com",
  passwordHash: "hash",
  provider: "local",
  roles: [] as string[],
  name: "Alice",
  createdAt: 1000,
  updatedAt: 1000,
  lastSeenAt: 1000,
  enabled: true,
};

// ── grant-role ─────────────────────────────────────────────────────────────────

Deno.test("users:grant-role adds the role to a role-less user's roles[]", async () => {
  await withTempSite(async (root) => {
    await writeUser(root, "u1.json", baseUser);

    await grantRoleCommand(root, "alice@example.com", "editor", {});

    const user = await readUser(root, "u1.json");
    assertEquals(user.roles, ["editor"]);
  });
});

Deno.test("users:grant-role syncs the app:admin authz tuple", async () => {
  await withTempSite(async (root) => {
    await writeUser(root, "u1.json", baseUser);

    await grantRoleCommand(root, "alice@example.com", "editor", {});

    assertEquals(await hasAdminTuple(root, "u1", "editor"), true);
  });
});

Deno.test("users:grant-role works on a former OAuth-only user (never had an admin-tier role)", async () => {
  await withTempSite(async (root) => {
    await writeUser(root, "u1.json", {
      ...baseUser,
      username: undefined,
      passwordHash: undefined,
      provider: "google",
      providerId: "g-123",
    });

    await grantRoleCommand(root, "alice@example.com", "admin", {});

    const user = await readUser(root, "u1.json");
    assertEquals(user.roles, ["admin"]);
    assertEquals(await hasAdminTuple(root, "u1", "admin"), true);
  });
});

Deno.test("users:grant-role replaces an existing admin-tier role rather than stacking it", async () => {
  await withTempSite(async (root) => {
    await writeUser(root, "u1.json", { ...baseUser, roles: ["author"] });

    await grantRoleCommand(root, "alice@example.com", "admin", {});

    const user = await readUser(root, "u1.json");
    assertEquals(user.roles, ["admin"]);
    assertEquals(await hasAdminTuple(root, "u1", "admin"), true);
    assertEquals(await hasAdminTuple(root, "u1", "author"), false);
  });
});

Deno.test("users:grant-role preserves non-admin-tier tags already on roles[]", async () => {
  await withTempSite(async (root) => {
    await writeUser(root, "u1.json", { ...baseUser, roles: ["subscriber"] });

    await grantRoleCommand(root, "alice@example.com", "editor", {});

    const user = await readUser(root, "u1.json");
    assertEquals((user.roles as string[]).sort(), ["editor", "subscriber"]);
  });
});

Deno.test("users:grant-role is idempotent — granting an already-held role is a no-op", async () => {
  await withTempSite(async (root) => {
    await writeUser(root, "u1.json", { ...baseUser, roles: ["editor"] });

    await grantRoleCommand(root, "alice@example.com", "editor", {});
    const user = await readUser(root, "u1.json");

    assertEquals(user.roles, ["editor"]);
    assertEquals(user.updatedAt, 1000); // untouched — no store write happened
  });
});

Deno.test("users:grant-role --dry-run makes no changes", async () => {
  await withTempSite(async (root) => {
    await writeUser(root, "u1.json", baseUser);

    await grantRoleCommand(root, "alice@example.com", "editor", {
      dryRun: true,
    });

    const user = await readUser(root, "u1.json");
    assertEquals(user.roles, []);
    assertEquals(await hasAdminTuple(root, "u1", "editor"), false);
  });
});

Deno.test("users:grant-role exits 1 for an unknown email", async () => {
  await withTempSite(async (root) => {
    await writeUser(root, "u1.json", baseUser);

    const exitCode = await withMockedExit(() =>
      grantRoleCommand(root, "nobody@example.com", "editor", {})
    );

    assertEquals(exitCode, 1);
  });
});

Deno.test("users:grant-role exits 1 for an invalid role", async () => {
  await withTempSite(async (root) => {
    await writeUser(root, "u1.json", baseUser);

    const exitCode = await withMockedExit(() =>
      grantRoleCommand(root, "alice@example.com", "superuser", {})
    );

    assertEquals(exitCode, 1);
  });
});

// ── revoke-role ────────────────────────────────────────────────────────────────

Deno.test("users:revoke-role removes the role from roles[]", async () => {
  await withTempSite(async (root) => {
    await writeUser(root, "u1.json", { ...baseUser, roles: ["editor"] });

    await revokeRoleCommand(root, "alice@example.com", "editor", {});

    const user = await readUser(root, "u1.json");
    assertEquals(user.roles, []);
  });
});

Deno.test("users:revoke-role removes the app:admin authz tuple", async () => {
  await withTempSite(async (root) => {
    await writeUser(root, "u1.json", { ...baseUser, roles: [] });
    await grantRoleCommand(root, "alice@example.com", "editor", {});
    assertEquals(await hasAdminTuple(root, "u1", "editor"), true);

    await revokeRoleCommand(root, "alice@example.com", "editor", {});

    assertEquals(await hasAdminTuple(root, "u1", "editor"), false);
  });
});

Deno.test("users:revoke-role preserves non-admin-tier tags", async () => {
  await withTempSite(async (root) => {
    await writeUser(root, "u1.json", {
      ...baseUser,
      roles: ["editor", "subscriber"],
    });

    await revokeRoleCommand(root, "alice@example.com", "editor", {});

    const user = await readUser(root, "u1.json");
    assertEquals(user.roles, ["subscriber"]);
  });
});

Deno.test("users:revoke-role is idempotent — revoking a role the user doesn't have is a no-op", async () => {
  await withTempSite(async (root) => {
    await writeUser(root, "u1.json", { ...baseUser, roles: [] });

    await revokeRoleCommand(root, "alice@example.com", "editor", {});
    const user = await readUser(root, "u1.json");

    assertEquals(user.roles, []);
    assertEquals(user.updatedAt, 1000);
  });
});

Deno.test("users:revoke-role --dry-run makes no changes", async () => {
  await withTempSite(async (root) => {
    await writeUser(root, "u1.json", { ...baseUser, roles: ["editor"] });

    await revokeRoleCommand(root, "alice@example.com", "editor", {
      dryRun: true,
    });

    const user = await readUser(root, "u1.json");
    assertEquals(user.roles, ["editor"]);
    assertEquals(await hasAdminTuple(root, "u1", "editor"), false);
  });
});

Deno.test("users:revoke-role exits 1 for an unknown email", async () => {
  await withTempSite(async (root) => {
    await writeUser(root, "u1.json", baseUser);

    const exitCode = await withMockedExit(() =>
      revokeRoleCommand(root, "nobody@example.com", "editor", {})
    );

    assertEquals(exitCode, 1);
  });
});

Deno.test("users:grant-role then users:revoke-role round-trips cleanly", async () => {
  await withTempSite(async (root) => {
    await writeUser(root, "u1.json", baseUser);

    await grantRoleCommand(root, "alice@example.com", "admin", {});
    assertEquals((await readUser(root, "u1.json")).roles, ["admin"]);
    assertExists(await hasAdminTuple(root, "u1", "admin"));

    await revokeRoleCommand(root, "alice@example.com", "admin", {});
    assertEquals((await readUser(root, "u1.json")).roles, []);
    assertEquals(await hasAdminTuple(root, "u1", "admin"), false);
  });
});
