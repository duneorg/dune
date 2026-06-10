/**
 * Tests for shared HTTP-serving utilities.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isAdminPath } from "../../src/cli/serve-utils.ts";

Deno.test("isAdminPath: matches the admin root and nested paths", () => {
  assertEquals(isAdminPath("/admin", "/admin"), true);
  assertEquals(isAdminPath("/admin/pages", "/admin"), true);
  assertEquals(isAdminPath("/admin/api/content/x", "/admin"), true);
});

Deno.test("isAdminPath: does not match sibling routes sharing the prefix string", () => {
  assertEquals(isAdminPath("/administrivia", "/admin"), false);
  assertEquals(isAdminPath("/admin-blog", "/admin"), false);
  assertEquals(isAdminPath("/", "/admin"), false);
  assertEquals(isAdminPath("/about", "/admin"), false);
});

Deno.test("isAdminPath: respects custom admin prefixes", () => {
  assertEquals(isAdminPath("/backstage", "/backstage"), true);
  assertEquals(isAdminPath("/backstage/users", "/backstage"), true);
  assertEquals(isAdminPath("/backstage-door", "/backstage"), false);
});
