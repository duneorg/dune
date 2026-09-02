/**
 * Tests for authz-schema.ts's roleHasPermission() — the synchronous,
 * role-only read of the canonical actionToRelations schema that replaced
 * plugin-admin's hand-maintained ROLE_PERMISSIONS mirror (dec-identity-
 * unification Phase 5c/6). Only used where a published, synchronous hook
 * API can't call the real, async authz.check() (response-transforms.ts).
 */

import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildDuneAuthzSchema,
  DUNE_BASE_AUTHZ_ACTIONS,
  highestAdminRole,
  roleHasPermission,
} from "../../src/auth/authz-schema.ts";

Deno.test("roleHasPermission: admin has every admin-tier permission", () => {
  assertEquals(roleHasPermission("admin", "pages.update"), true);
  assertEquals(roleHasPermission("admin", "users.update"), true);
  assertEquals(roleHasPermission("admin", "config.update"), true);
});

Deno.test("roleHasPermission: editor has pages/media/config-read but not admin-only actions", () => {
  assertEquals(roleHasPermission("editor", "pages.update"), true);
  assertEquals(roleHasPermission("editor", "config.read"), true);
  assertEquals(roleHasPermission("editor", "config.update"), false);
  assertEquals(roleHasPermission("editor", "users.update"), false);
});

Deno.test("roleHasPermission: author is more restricted than editor", () => {
  assertEquals(roleHasPermission("author", "pages.update"), true);
  assertEquals(roleHasPermission("author", "media.delete"), false);
  assertEquals(roleHasPermission("author", "config.read"), false);
});

Deno.test("roleHasPermission: unknown role or unknown permission both deny", () => {
  assertEquals(roleHasPermission("not-a-real-role", "pages.update"), false);
  assertEquals(roleHasPermission("admin", "not-a-real-permission"), false);
});

Deno.test("highestAdminRole: picks the highest admin-tier role regardless of order", () => {
  assertEquals(highestAdminRole(["member", "admin"]), "admin");
  assertEquals(highestAdminRole(["editor", "admin"]), "admin");
  assertEquals(highestAdminRole(["member", "editor", "author"]), "editor");
  assertEquals(highestAdminRole(["author"]), "author");
});

Deno.test("highestAdminRole: ignores content-gating tags and unknown roles", () => {
  assertEquals(highestAdminRole(["member", "subscriber"]), "");
  assertEquals(highestAdminRole(["member"]), "");
  assertEquals(highestAdminRole(undefined), "");
  assertEquals(highestAdminRole([]), "");
});

Deno.test("buildDuneAuthzSchema: with no plugin actions, matches the built-ins exactly", () => {
  const schema = buildDuneAuthzSchema();
  assertEquals(schema.actionToRelations, DUNE_BASE_AUTHZ_ACTIONS);
});

Deno.test("buildDuneAuthzSchema: merges a plugin-contributed action in", () => {
  const schema = buildDuneAuthzSchema({ "billing.manage": ["admin"] });
  assertEquals(schema.actionToRelations["billing.manage"], ["admin"]);
  // Built-ins are still present, untouched.
  assertEquals(schema.actionToRelations["pages.update"], ["admin", "editor", "author"]);
});

Deno.test("buildDuneAuthzSchema: rejects a plugin action naming an undefined relation", () => {
  // defineSchema() itself validates every actionToRelations entry against
  // the relations map — a plugin can't invent a new relation type by
  // slipping an unknown one into its authzActions.
  assertThrows(() =>
    buildDuneAuthzSchema({
      // deno-lint-ignore no-explicit-any
      "billing.manage": ["superadmin" as any],
    })
  );
});

Deno.test("roleHasPermission: resolves a plugin-contributed action when its actionToRelations map is passed", () => {
  const schema = buildDuneAuthzSchema({ "billing.manage": ["admin"] });
  const relations = schema.actionToRelations as Record<string, readonly string[]>;
  assertEquals(roleHasPermission("admin", "billing.manage", relations), true);
  assertEquals(roleHasPermission("editor", "billing.manage", relations), false);
  // A plugin action is invisible without its site's own map — the default
  // (built-ins only) correctly denies it, not silently allows.
  assertEquals(roleHasPermission("admin", "billing.manage"), false);
});
