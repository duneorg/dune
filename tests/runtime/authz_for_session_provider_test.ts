/**
 * The authz system is created for the built-in admin (when enabled) and for any
 * plugin that provides `auth.session`, so a replacement admin can authorise its
 * sessions even with `admin.enabled: false`.
 */

import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { bootstrap } from "../../src/runtime/bootstrap.ts";
import type { DunePlugin } from "../../src/hooks/types.ts";

async function withSite(plugins: DunePlugin[], fn: (ctx: Awaited<ReturnType<typeof bootstrap>>) => void) {
  const root = await Deno.makeTempDir({ prefix: "dune_test_authz_provider_" });
  try {
    await Deno.mkdir(join(root, "content", "01.home"), { recursive: true });
    await Deno.writeTextFile(join(root, "content", "01.home", "default.md"), "---\ntitle: Home\n---\n\nHi\n");
    // deno-lint-ignore no-explicit-any
    fn(await bootstrap(root, { plugins, configOverrides: { admin: { enabled: false } as any } }));
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
}

const sessionProvider: DunePlugin = {
  name: "other-admin",
  version: "1.0.0",
  hooks: {},
  setup(api) {
    api.capabilities.provide("auth.session", () => ({
      authenticate: () => Promise.resolve({ authenticated: false }),
    }));
  },
};

Deno.test(
  "admin disabled and nobody provides auth.session: no authz system",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withSite([], (ctx) => assertEquals(ctx.authz, undefined));
  },
);

Deno.test(
  "admin disabled but another plugin provides auth.session: the authz system exists",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withSite([sessionProvider], (ctx) => assertExists(ctx.authz));
  },
);
