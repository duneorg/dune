/**
 * Tests for authz-schema.ts's roleHasPermission() — the synchronous,
 * role-only read of the canonical actionToRelations schema that replaced
 * plugin-admin's hand-maintained ROLE_PERMISSIONS mirror (dec-identity-
 * unification Phase 5c/6). Only used where a published, synchronous hook
 * API can't call the real, async authz.check() (response-transforms.ts).
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { roleHasPermission } from "../../src/auth/authz-schema.ts";

Deno.test("roleHasPermission: admin has every admin-tier permission", () => {
  assertEquals(roleHasPermission("admin", "pages.update"), true);
  assertEquals(roleHasPermission("admin", "users.manage"), true);
  assertEquals(roleHasPermission("admin", "config.update"), true);
});

Deno.test("roleHasPermission: editor has pages/media/config-read but not admin-only actions", () => {
  assertEquals(roleHasPermission("editor", "pages.update"), true);
  assertEquals(roleHasPermission("editor", "config.read"), true);
  assertEquals(roleHasPermission("editor", "config.update"), false);
  assertEquals(roleHasPermission("editor", "users.manage"), false);
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
