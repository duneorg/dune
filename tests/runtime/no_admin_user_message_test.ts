/**
 * Startup says so when the admin panel is on but no admin user exists:
 * Dune creates no default admin, so nobody could log in and nothing else says why.
 */

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { join } from "@std/path";
import { bootstrap } from "../../src/runtime/bootstrap.ts";
import { createLocalUserStore } from "../../src/auth/user-store.ts";
import { createStorage } from "../../src/storage/mod.ts";
import type { DunePlugin } from "../../src/hooks/types.ts";

const adminPlugin: DunePlugin = {
  name: "test-admin",
  version: "1.0.0",
  hooks: {},
  setup(api) {
    api.capabilities.provide("admin.prefix", () => ({ prefix: "/admin" }));
  },
};

async function bootLogs(
  plugins: DunePlugin[],
  seed?: (root: string) => Promise<void>,
): Promise<string> {
  const root = await Deno.makeTempDir({ prefix: "dune_test_no_admin_user_" });
  const lines: string[] = [];
  const realError = console.error;
  try {
    await Deno.mkdir(join(root, "content", "01.home"), { recursive: true });
    await Deno.writeTextFile(
      join(root, "content", "01.home", "default.md"),
      "---\ntitle: Home\n---\n\n# Home\n",
    );
    await seed?.(root);
    console.error = (...a: unknown[]) => lines.push(a.join(" "));
    await bootstrap(root, { plugins });
  } finally {
    console.error = realError;
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
  return lines.join("\n");
}

const opts = { sanitizeOps: false, sanitizeResources: false };

Deno.test("startup: admin on and no admin user → says how to create one", opts, async () => {
  const out = await bootLogs([adminPlugin]);
  assert(out.includes("bootstrap.no_admin_user"), out);
  assert(out.includes("users:create"), out);
});

Deno.test("startup: a user without the admin role still counts as no admin", opts, async () => {
  const out = await bootLogs([adminPlugin], async (root) => {
    const store = createLocalUserStore({
      storage: createStorage({ rootDir: root }),
      usersDir: "data/users",
    });
    await store.create({
      email: "member@example.com",
      username: "member",
      provider: "local",
      roles: [],
      passwordHash: "x",
    });
  });
  assert(out.includes("bootstrap.no_admin_user"), out);
});

Deno.test("startup: an enabled admin exists → no message", opts, async () => {
  const out = await bootLogs([adminPlugin], async (root) => {
    const store = createLocalUserStore({
      storage: createStorage({ rootDir: root }),
      usersDir: "data/users",
    });
    await store.create({
      email: "a@example.com",
      username: "a",
      provider: "local",
      roles: ["admin"],
      passwordHash: "x",
    });
  });
  assertEquals(out.includes("bootstrap.no_admin_user"), false, out);
});

Deno.test(
  "startup: no admin plugin → no admin-user message (site may not want one)",
  opts,
  async () => {
    const out = await bootLogs([]);
    assertEquals(out.includes("bootstrap.no_admin_user"), false, out);
    assert(out.includes("bootstrap.no_admin"), out);
  },
);
