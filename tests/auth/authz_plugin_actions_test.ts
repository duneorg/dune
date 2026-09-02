/**
 * End-to-end test for DunePlugin.authzActions — a plugin can register its
 * own admin-permission action, gated the same correct way as every
 * built-in one (authz.check()), instead of reusing a semantically
 * mismatched permission or hand-rolling a check outside the authz system.
 *
 * Covers the real bootstrap() path: a plugin declares authzActions in its
 * setup()/plugin object, bootstrap() collects and merges it into the
 * site's actual authz schema (BootstrapResult.authzSchema) before the
 * authz system is created, and authz.check() resolves it correctly for a
 * real request-shaped check — not just buildDuneAuthzSchema() in
 * isolation (see authz_schema_test.ts for the unit-level coverage of the
 * builder itself).
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { join } from "@std/path";
import { bootstrap } from "../../src/runtime/bootstrap.ts";
import type { DunePlugin } from "../../src/hooks/types.ts";

async function makeSiteRoot(prefix: string): Promise<string> {
  const root = await Deno.makeTempDir({ prefix });
  await Deno.mkdir(join(root, "content", "01.home"), { recursive: true });
  await Deno.writeTextFile(
    join(root, "content", "01.home", "default.md"),
    "---\ntitle: Home\n---\n\n# Home\n",
  );
  return root;
}

async function removeWithRetry(root: string): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await Deno.remove(root, { recursive: true });
      return;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  throw lastErr;
}

Deno.test(
  "DunePlugin.authzActions: a plugin-contributed action is merged in and enforced end to end",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    const root = await makeSiteRoot("dune_test_authz_plugin_actions_");
    try {
      const billingPlugin: DunePlugin = {
        name: "test-billing-plugin",
        version: "1.0.0",
        hooks: {},
        authzActions: {
          "billing.manage": ["admin"],
        },
      };

      const ctx = await bootstrap(root, { plugins: [billingPlugin] });

      // Merged into the site's actual schema.
      const relations = ctx.authzSchema.actionToRelations as Record<
        string,
        readonly string[]
      >;
      assertEquals(relations["billing.manage"], ["admin"]);
      // Built-ins are untouched.
      assertEquals(relations["pages.update"], ["admin", "editor", "author"]);

      // And the real authz system — built against that same merged schema
      // — actually enforces it, not just the schema data structure.
      const authz = ctx.authz!;
      await authz.allow({
        who: { type: "user", id: "alice" },
        toBe: "admin",
        onWhat: { type: "app", id: "admin" },
      });

      const allowed = await authz.check({
        who: { type: "user", id: "alice" },
        // deno-lint-ignore no-explicit-any
        canThey: "billing.manage" as any,
        onWhat: { type: "app", id: "admin" },
      });
      assertEquals(allowed, true);

      const deniedForBob = await authz.check({
        who: { type: "user", id: "bob" },
        // deno-lint-ignore no-explicit-any
        canThey: "billing.manage" as any,
        onWhat: { type: "app", id: "admin" },
      });
      assertEquals(deniedForBob, false);
    } finally {
      await removeWithRetry(root);
    }
  },
);

Deno.test(
  "DunePlugin.authzActions: a name colliding with a built-in action is dropped, built-in wins",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    const root = await makeSiteRoot("dune_test_authz_plugin_actions_builtin_collision_");
    try {
      const maliciousPlugin: DunePlugin = {
        name: "test-redefines-builtin",
        version: "1.0.0",
        hooks: {},
        authzActions: {
          // Tries to widen who can delete pages — must not take effect.
          "pages.delete": ["admin", "editor", "author"],
        },
      };

      const ctx = await bootstrap(root, { plugins: [maliciousPlugin] });
      const relations = ctx.authzSchema.actionToRelations as Record<
        string,
        readonly string[]
      >;
      // Untouched — the built-in definition still wins.
      assertEquals(relations["pages.delete"], ["admin"]);
    } finally {
      await removeWithRetry(root);
    }
  },
);

Deno.test(
  "DunePlugin.authzActions: a name colliding across two plugins keeps the first registered, drops the second",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    const root = await makeSiteRoot("dune_test_authz_plugin_actions_cross_plugin_collision_");
    try {
      const first: DunePlugin = {
        name: "test-plugin-first",
        version: "1.0.0",
        hooks: {},
        authzActions: { "billing.manage": ["admin"] },
      };
      const second: DunePlugin = {
        name: "test-plugin-second",
        version: "1.0.0",
        hooks: {},
        authzActions: { "billing.manage": ["admin", "editor", "author"] },
      };

      const ctx = await bootstrap(root, { plugins: [first, second] });
      const relations = ctx.authzSchema.actionToRelations as Record<
        string,
        readonly string[]
      >;
      // First plugin's declaration wins — not merged, not overwritten.
      assertEquals(relations["billing.manage"], ["admin"]);
    } finally {
      await removeWithRetry(root);
    }
  },
);
