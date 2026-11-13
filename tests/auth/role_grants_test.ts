/**
 * `system.role_grants`: which groups hold the admin-tier relations on the site.
 * Default: admin, editor and author each hold their own. The bootstrap
 * reconciles, so a grant that is no longer configured is revoked.
 */

import { assertEquals } from "@std/assert";
import { createStorage } from "../../src/storage/mod.ts";
import { bootstrapRoleGrants, createDuneAuthSystem } from "../../src/auth/authz.ts";
import { SITE_RESOURCE } from "../../src/auth/authz-schema.ts";
import {
  DEFAULT_ROLE_GRANTS,
  resolveRoleGrants,
  roleGrantProblems,
  type RoleGrants,
} from "../../src/auth/role-grants.ts";
import { validateConfig } from "../../src/config/validator.ts";
import { DEFAULT_CONFIG } from "../../src/config/defaults.ts";
import type { DuneConfig } from "../../src/config/types.ts";

async function withAuthz(
  fn: (t: {
    grants: (g: RoleGrants) => Promise<void>;
    holders: (relation: string) => Promise<string[]>;
    join: (userId: string, group: string) => Promise<void>;
    canEdit: (userId: string) => Promise<boolean>;
  }) => Promise<void>,
) {
  const root = await Deno.makeTempDir({ prefix: "dune_test_role_grants_" });
  try {
    const { authz, adapter } = createDuneAuthSystem(
      { authzStore: "local", dataDir: "data" },
      createStorage({ rootDir: root }),
    );
    await fn({
      grants: (g) => bootstrapRoleGrants(authz, adapter, g),
      holders: async (relation) =>
        (await adapter.findSubjects(SITE_RESOURCE, relation, { subjectType: "group" })).map((s) =>
          s.id
        ).sort(),
      join: async (userId, group) => {
        await authz.addMember({
          member: { type: "user", id: userId },
          group: { type: "group", id: group },
        });
      },
      // deno-lint-ignore no-explicit-any
      canEdit: (id) =>
        authz.check({
          who: { type: "user", id },
          canThey: "pages.update" as any,
          onWhat: SITE_RESOURCE,
        }),
    });
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
}

const cfg = (system: Record<string, unknown>) =>
  ({ ...DEFAULT_CONFIG, system: { ...DEFAULT_CONFIG.system, ...system } }) as DuneConfig;

Deno.test("with nothing configured the three admin-tier groups hold their own relation", async () => {
  assertEquals(resolveRoleGrants(cfg({})), { ...DEFAULT_ROLE_GRANTS });
  await withAuthz(async ({ grants, holders }) => {
    await grants(resolveRoleGrants(cfg({})));
    assertEquals(await holders("admin"), ["admin"]);
    assertEquals(await holders("editor"), ["editor"]);
    assertEquals(await holders("author"), ["author"]);
  });
});

Deno.test("{} turns the group-level grants off, and a grant written by an earlier run is revoked", async () => {
  await withAuthz(async ({ grants, holders, join, canEdit }) => {
    await join("u1", "editor");
    await grants(resolveRoleGrants(cfg({})));
    assertEquals(await canEdit("u1"), true);

    await grants(resolveRoleGrants(cfg({ role_grants: {} })));
    for (const r of ["admin", "editor", "author"]) assertEquals(await holders(r), []);
    assertEquals(await canEdit("u1"), false, "membership alone grants nothing any more");
  });
});

Deno.test("remapping gives your own group the relation and takes it from the default one", async () => {
  await withAuthz(async ({ grants, holders, join, canEdit }) => {
    await join("staff-member", "staff");
    await join("tier-member", "editor");
    await grants(resolveRoleGrants(cfg({})));
    assertEquals(await canEdit("tier-member"), true);
    assertEquals(await canEdit("staff-member"), false);

    await grants(resolveRoleGrants(cfg({ role_grants: { staff: "editor" } })));
    assertEquals(await holders("editor"), ["staff"]);
    assertEquals(await canEdit("staff-member"), true);
    assertEquals(
      await canEdit("tier-member"),
      false,
      "'editor' is a content tier on this site now",
    );
  });
});

Deno.test("a subset keeps only what is listed; running twice changes nothing", async () => {
  await withAuthz(async ({ grants, holders }) => {
    const only = resolveRoleGrants(cfg({ role_grants: { author: "author" } }));
    await grants(only);
    await grants(only);
    assertEquals(await holders("author"), ["author"]);
    assertEquals(await holders("editor"), []);
    assertEquals(await holders("admin"), []);
  });
});

Deno.test("an unknown relation or a non-mapping is a config error, not a silent default", () => {
  assertEquals(roleGrantProblems(undefined), []);
  assertEquals(roleGrantProblems({}), []);
  assertEquals(roleGrantProblems({ staff: "editor" }), []);
  assertEquals(roleGrantProblems({ staff: "owner" }).length, 1);
  assertEquals(roleGrantProblems(["editor"]).length, 1);
  assertEquals(roleGrantProblems("editor").length, 1);
  const errors = validateConfig(cfg({ role_grants: { staff: "superuser" } }));
  assertEquals(errors.some((e) => e.includes("system.role_grants")), true);
  assertEquals(
    validateConfig(cfg({ role_grants: { staff: "editor" } })).some((e) =>
      e.includes("role_grants")
    ),
    false,
  );
});
