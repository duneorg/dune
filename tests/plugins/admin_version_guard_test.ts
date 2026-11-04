import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  adminSettingsAtRisk,
  checkAdminVersion,
  MIN_ADMIN_MAJOR,
} from "../../src/plugins/builtin.ts";
import { DEFAULT_CONFIG } from "../../src/config/defaults.ts";
import type { DuneConfig } from "../../src/config/types.ts";

function withAdmin(admin: Record<string, unknown>): DuneConfig {
  const c = structuredClone(DEFAULT_CONFIG);
  Object.assign(c.admin as object, admin);
  return c;
}

Deno.test("adminSettingsAtRisk: a default config has nothing at risk", () => {
  assertEquals(adminSettingsAtRisk(structuredClone(DEFAULT_CONFIG)), []);
});

Deno.test("adminSettingsAtRisk: names every renamed admin-read key moved off its default", () => {
  const c = withAdmin({
    runtime_dir: "var/admin",
    authz_store: "db",
    max_upload_mb: 5,
    audit: { log_file: "a.log" },
    auth_provider: { type: "ldap" },
  });
  assertEquals(adminSettingsAtRisk(c), [
    "admin.runtime_dir",
    "admin.max_upload_mb",
    "admin.authz_store",
    "admin.audit.log_file",
    "admin.auth_provider",
  ]);
});

Deno.test("adminSettingsAtRisk: a value equal to the default is not at risk", () => {
  assertEquals(
    adminSettingsAtRisk(withAdmin({ runtime_dir: ".dune/admin" })),
    [],
  );
});

Deno.test("checkAdminVersion: admin >= the minimum major is ok", () => {
  const c = withAdmin({ runtime_dir: "var/admin" });
  assertEquals(checkAdminVersion(`${MIN_ADMIN_MAJOR}.0.0`, c).level, "ok");
  assertEquals(checkAdminVersion(`${MIN_ADMIN_MAJOR + 1}.2.3`, c).level, "ok");
});

Deno.test("checkAdminVersion: old admin on an all-defaults config only warns", () => {
  const r = checkAdminVersion("3.3.0", structuredClone(DEFAULT_CONFIG));
  assertEquals(r.level, "warn");
  assertStringIncludes(r.message!, "3.3.0");
});

Deno.test("checkAdminVersion: old admin plus a customised renamed key refuses and names it", () => {
  const r = checkAdminVersion("3.3.0", withAdmin({ authz_store: "db" }));
  assertEquals(r.level, "refuse");
  assertStringIncludes(r.message!, "admin.authz_store");
});

Deno.test("checkAdminVersion: an unreadable version is never treated as old", () => {
  assertEquals(
    checkAdminVersion(undefined, withAdmin({ authz_store: "db" })).level,
    "ok",
  );
  assertEquals(
    checkAdminVersion("not-a-version", withAdmin({ authz_store: "db" })).level,
    "ok",
  );
});
