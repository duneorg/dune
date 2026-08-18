/**
 * Tests for `dune migrate:roles-to-tuples` — ensures polizy group-membership
 * tuples (`user --member--> group:<role>`) exist for every role in each
 * user's `roles[]`.
 *
 * No prior coverage existed for this command at all before this file — which
 * is how a real, previously-latent bug went unnoticed: `dataDir` was built
 * via `join(root, config.admin?.dataDir ?? "data")`, an absolute path, but
 * StorageAdapter (src/storage/fs.ts) requires paths relative to its own
 * rootDir and silently swallows the resulting PathEscapeError into "empty
 * results" (userStore.list() returning `[]`, indistinguishable from "no
 * users have roles"). The command reported "No users with roles found —
 * nothing to migrate." on every real site, every time it ran, regardless of
 * actual data. Fixed by making `dataDir` relative (matching the convention
 * @dune/plugin-admin's mod.ts already used correctly).
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { join } from "@std/path";
import { migrateRolesToTuplesCommand } from "../../src/cli/migrate-roles-to-tuples.ts";
import { createStorage } from "../../src/storage/mod.ts";
import { AuthzLocalAdapter } from "../../src/auth/authz-adapter-local.ts";

async function withTempSite(
  fn: (root: string) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "dune_test_migrate_roles_" });
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

/** True if a { type:"user", id } --member--> { type:"group", id: role } tuple exists on disk. */
async function hasGroupTuple(
  root: string,
  userId: string,
  role: string,
): Promise<boolean> {
  const storage = createStorage({ rootDir: root });
  const adapter = new AuthzLocalAdapter({ storage, dataDir: "data" });
  return await adapter.hasTuple(
    { type: "user", id: userId },
    "member",
    { type: "group", id: role },
  );
}

const baseUser = {
  id: "u1",
  username: "alice",
  email: "alice@example.com",
  provider: "local",
  name: "Alice",
  createdAt: 1000,
  updatedAt: 1000,
  lastSeenAt: 1000,
  enabled: true,
};

Deno.test("migrate:roles-to-tuples: finds users with roles on a real site (regression — used to always report zero)", async () => {
  await withTempSite(async (root) => {
    await writeUser(root, "u1.json", { ...baseUser, roles: ["admin"] });

    // Capture console.log output to confirm it doesn't take the
    // "no users with roles found" early-return path.
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));
    try {
      await migrateRolesToTuplesCommand(root, { dryRun: true });
    } finally {
      console.log = origLog;
    }

    const foundNothing = logs.some((l) =>
      l.includes("No users with roles found")
    );
    assertEquals(foundNothing, false);
  });
});

Deno.test("migrate:roles-to-tuples: creates a group:<role> member tuple for a user's role", async () => {
  await withTempSite(async (root) => {
    await writeUser(root, "u1.json", { ...baseUser, roles: ["admin"] });

    await migrateRolesToTuplesCommand(root, {});

    assertEquals(await hasGroupTuple(root, "u1", "admin"), true);
  });
});

Deno.test("migrate:roles-to-tuples: creates a tuple per role for a multi-role user", async () => {
  await withTempSite(async (root) => {
    await writeUser(root, "u1.json", {
      ...baseUser,
      roles: ["editor", "subscriber"],
    });

    await migrateRolesToTuplesCommand(root, {});

    assertEquals(await hasGroupTuple(root, "u1", "editor"), true);
    assertEquals(await hasGroupTuple(root, "u1", "subscriber"), true);
  });
});

Deno.test("migrate:roles-to-tuples: is idempotent — a second run creates no duplicate tuples", async () => {
  await withTempSite(async (root) => {
    await writeUser(root, "u1.json", { ...baseUser, roles: ["admin"] });

    await migrateRolesToTuplesCommand(root, {});
    await migrateRolesToTuplesCommand(root, {});

    const storage = createStorage({ rootDir: root });
    const adapter = new AuthzLocalAdapter({ storage, dataDir: "data" });
    const matches = await adapter.findTuples({
      subject: { type: "user", id: "u1" },
      relation: "member",
      object: { type: "group", id: "admin" },
    });
    assertEquals(matches.length, 1);
  });
});

Deno.test("migrate:roles-to-tuples: --dry-run creates no tuples", async () => {
  await withTempSite(async (root) => {
    await writeUser(root, "u1.json", { ...baseUser, roles: ["admin"] });

    await migrateRolesToTuplesCommand(root, { dryRun: true });

    assertEquals(await hasGroupTuple(root, "u1", "admin"), false);
  });
});

Deno.test("migrate:roles-to-tuples: a role-less user produces no tuples and no error", async () => {
  await withTempSite(async (root) => {
    await writeUser(root, "u1.json", { ...baseUser, roles: [] });

    await migrateRolesToTuplesCommand(root, {});

    assertEquals(await hasGroupTuple(root, "u1", "admin"), false);
  });
});
