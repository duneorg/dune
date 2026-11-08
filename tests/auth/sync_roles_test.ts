/**
 * A role granted or revoked while the app runs reaches the authz store at
 * once: group membership follows `roles[]` for every write through the user
 * store, so page gating and the site-wide grants of the admin-tier roles
 * need no restart.
 */

import { assertEquals } from "@std/assert";
import { createStorage } from "../../src/storage/mod.ts";
import { bootstrapRoleGrants, createDuneAuthSystem } from "../../src/auth/authz.ts";
import { SITE_RESOURCE } from "../../src/auth/authz-schema.ts";
import { createLocalUserStore } from "../../src/auth/user-store.ts";
import { withRoleSync } from "../../src/auth/sync-roles.ts";

async function withStore(
  fn: (
    ctx: {
      store: ReturnType<typeof withRoleSync>;
      authz: ReturnType<typeof createDuneAuthSystem>["authz"];
      adapter: ReturnType<typeof createDuneAuthSystem>["adapter"];
      canEdit: (id: string) => Promise<boolean>;
      groups: (id: string) => Promise<string[]>;
    },
  ) => Promise<void>,
) {
  const root = await Deno.makeTempDir({ prefix: "dune_test_sync_roles_" });
  try {
    const storage = createStorage({ rootDir: root });
    const { authz, adapter } = createDuneAuthSystem({ authzStore: "local", dataDir: "data" }, storage);
    await bootstrapRoleGrants(authz, adapter);
    const store = withRoleSync(
      createLocalUserStore({ storage, usersDir: "data/users" }),
      () => ({ authz, adapter }),
    );
    await fn({
      store,
      authz,
      adapter,
      canEdit: (id) =>
        authz.check({
          who: { type: "user", id },
          // deno-lint-ignore no-explicit-any
          canThey: "pages.update" as any,
          onWhat: SITE_RESOURCE,
        }),
      groups: async (id) =>
        (await adapter.findObjects({ type: "user", id }, "member", { objectType: "group" }))
          .map((g) => g.id).sort(),
    });
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
}

Deno.test("create: a user created with roles is a member of those groups", async () => {
  await withStore(async ({ store, groups, canEdit }) => {
    const ed = await store.create({ email: "ed@example.com", provider: "local", roles: ["editor", "vip"] });
    assertEquals(await groups(ed.id), ["editor", "vip"]);
    assertEquals(await canEdit(ed.id), true);
  });
});

Deno.test("update: granting and revoking a role takes effect with no restart", async () => {
  await withStore(async ({ store, groups, canEdit }) => {
    const u = await store.create({ email: "u@example.com", provider: "local", roles: [] });
    assertEquals(await canEdit(u.id), false);

    await store.update(u.id, { roles: ["editor"] });
    assertEquals(await groups(u.id), ["editor"]);
    assertEquals(await canEdit(u.id), true);

    // editor -> subscriber: the old membership goes, so the old grant goes with it.
    await store.update(u.id, { roles: ["subscriber"] });
    assertEquals(await groups(u.id), ["subscriber"]);
    assertEquals(await canEdit(u.id), false);
  });
});

Deno.test("update without roles leaves membership alone", async () => {
  await withStore(async ({ store, groups }) => {
    const u = await store.create({ email: "a@example.com", provider: "local", roles: ["author"] });
    await store.update(u.id, { name: "Ann" });
    assertEquals(await groups(u.id), ["author"]);
  });
});

Deno.test("delete: a deleted user keeps no tuples", async () => {
  await withStore(async ({ store, groups, canEdit }) => {
    const u = await store.create({ email: "d@example.com", provider: "local", roles: ["admin"] });
    assertEquals(await canEdit(u.id), true);
    assertEquals(await store.delete(u.id), true);
    assertEquals(await groups(u.id), []);
    assertEquals(await canEdit(u.id), false);
  });
});

Deno.test("no authz target: writes pass straight through", async () => {
  const root = await Deno.makeTempDir({ prefix: "dune_test_sync_roles_none_" });
  try {
    const store = withRoleSync(
      createLocalUserStore({ storage: createStorage({ rootDir: root }), usersDir: "data/users" }),
      () => undefined,
    );
    const u = await store.create({ email: "n@example.com", provider: "local", roles: ["editor"] });
    assertEquals((await store.update(u.id, { roles: [] }))?.roles, []);
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});
