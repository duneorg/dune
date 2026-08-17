/**
 * Regression test for dec-identity-unification Phase 2: the admin panel's
 * own authz instance must be created based on `admin.authzStore` (default
 * "local"), independent of `site.auth`'s mode/authzStore.
 *
 * Before this fix, bootstrap() derived the admin-side authz-creation
 * decision from the public-auth config. A site running
 * `site.auth.mode: external-jwt` with no `site.auth.authzStore` (a valid,
 * even common, external-jwt setup — the external IdP owns public-user
 * roles) would silently end up with no admin authz instance either, even
 * though admin-user tuples (bootstrapAdminTuples()) are an unrelated
 * identity concern. requirePermission() would then silently fall back to
 * the flat ROLE_PERMISSIONS table with no warning.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { join } from "@std/path";
import { bootstrap } from "../../src/runtime/bootstrap.ts";

async function withBootstrappedSite(
  siteYaml: string,
  fn: (ctx: Awaited<ReturnType<typeof bootstrap>>) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({
    prefix: "dune_test_bootstrap_admin_authz_",
  });
  try {
    await Deno.mkdir(join(root, "content", "01.home"), { recursive: true });
    await Deno.writeTextFile(
      join(root, "content", "01.home", "default.md"),
      "---\ntitle: Home\n---\n\nHello\n",
    );
    await Deno.mkdir(join(root, "config"), { recursive: true });
    await Deno.writeTextFile(join(root, "config", "site.yaml"), siteYaml);

    const ctx = await bootstrap(root, {});
    await fn(ctx);
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
}

Deno.test(
  "bootstrap(): admin authz is created even when site.auth is in external-jwt mode with no authzStore",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withBootstrappedSite(
      "title: Test Site\nurl: http://localhost:3000\n" +
        "auth:\n  mode: external-jwt\n  jwt:\n    secret: test-secret\n    issuer: https://idp.example.com\n",
      async (ctx) => {
        assertEquals(typeof ctx.authz?.check, "function");
        assertEquals(ctx.authzAdapter !== undefined, true);
      },
    );
  },
);

Deno.test(
  "bootstrap(): admin.authzStore is unset by default, admin authz still created in plain dune mode",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withBootstrappedSite(
      "title: Test Site\nurl: http://localhost:3000\nauth:\n  mode: dune\n",
      async (ctx) => {
        assertEquals(typeof ctx.authz?.check, "function");
      },
    );
  },
);
