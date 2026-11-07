/**
 * A signed-in site user whose role is an editing role may edit inline, with
 * or without an admin plugin (duneorg/dune#130).
 *
 * The site has a login (`site.auth`) and a stub plugin providing the
 * `editor.inline` slot, and no admin. Before the fix the authz system did not
 * exist for such a site, and where it did, a site user's role granted nothing
 * because the permission lived in per-user tuples only the admin plugin wrote.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { bootstrap } from "../../src/runtime/bootstrap.ts";
import { createDuneApp } from "../../src/runtime/server.ts";
import type { DunePlugin } from "../../src/hooks/types.ts";
import { createLocalUserStore } from "../../src/auth/user-store.ts";
import { createSessionManager, createSessionStore } from "../../src/session/mod.ts";
import { createStorage } from "../../src/storage/mod.ts";
import { SITE_COOKIE_NAME } from "../../src/auth/middleware.ts";

const inlineEdit: DunePlugin = {
  name: "test-inline-edit",
  version: "1.0.0",
  hooks: {},
  setup(api) {
    api.capabilities.provide("editor.inline", () => ({
      handleUpgrade: () => new Response(null, { status: 204 }),
    } as never));
  },
};

const sessionProvider: DunePlugin = {
  name: "test-session-provider",
  version: "1.0.0",
  hooks: {},
  setup(api) {
    api.capabilities.provide("editor.session", () => ({
      authenticate: () => Promise.resolve({ authenticated: false }),
    }));
  },
};

const ROLES = ["author", "editor", "admin", "member", "subscriber"];

/**
 * Run `fn` against a site with a login and one existing user per role. The
 * users exist before the site starts because that is when site auth seeds
 * their group membership.
 */
async function withSite(
  plugins: DunePlugin[],
  fn: (
    ws: (cookie?: string) => Promise<Response>,
    cookieFor: (role: string) => Promise<string>,
    plugin: { services: Awaited<ReturnType<typeof bootstrap>>["pluginServices"]; ids: Map<string, string> },
  ) => Promise<void>,
) {
  const root = await Deno.makeTempDir({ prefix: "dune_test_site_user_editing_" });
  try {
    await Deno.mkdir(join(root, "content", "01.home"), { recursive: true });
    await Deno.writeTextFile(join(root, "content", "01.home", "default.md"), "---\ntitle: Home\n---\n\nHi\n");
    await Deno.mkdir(join(root, "config"), { recursive: true });
    await Deno.writeTextFile(
      join(root, "config", "site.yaml"),
      "title: Test\nurl: http://localhost\nauth:\n  mode: dune\n",
    );
    const userStore = createLocalUserStore({ storage: createStorage({ rootDir: root }), usersDir: "data/users" });
    const ids = new Map<string, string>();
    for (const role of ROLES) {
      const user = await userStore.create({ email: `${role}@example.com`, provider: "local", roles: [role] });
      ids.set(role, user.id);
    }
    const ctx = await bootstrap(root, { plugins: [inlineEdit, ...plugins] });
    const { app } = await createDuneApp(ctx, { root, port: 0, dev: false });
    const handler = app.handler();

    const sessions = createSessionManager(
      await createSessionStore({
        type: "local",
        storage: ctx.storage,
        sessionsDir: ".dune/admin/site-sessions",
        lifetimeMs: 60_000,
      }),
      60_000,
    );
    const cookieFor = async (role: string) => {
      const session = await sessions.create(ids.get(role)!);
      return `${SITE_COOKIE_NAME}=${session.id}`;
    };
    const ws = (cookie?: string) =>
      handler(
        new Request("http://localhost/api/inline-edit/ws?path=01.home/default.md", {
          headers: {
            upgrade: "websocket",
            origin: "http://localhost",
            ...(cookie ? { cookie } : {}),
          },
        }),
      );
    await fn(ws, cookieFor, { services: ctx.pluginServices, ids });
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
}

const opts = { sanitizeOps: false, sanitizeResources: false };

Deno.test("login only, no admin: an editor may edit, a plain member may not", opts, async () => {
  await withSite([], async (ws, cookieFor) => {
    assertEquals((await ws(await cookieFor("editor"))).status, 204);
    assertEquals((await ws(await cookieFor("member"))).status, 403);
    assertEquals((await ws()).status, 401);
  });
});

Deno.test("login plus a plugin providing editor.session: same answers", opts, async () => {
  await withSite([sessionProvider], async (ws, cookieFor) => {
    assertEquals((await ws(await cookieFor("editor"))).status, 204);
    assertEquals((await ws(await cookieFor("member"))).status, 403);
  });
});

Deno.test("every admin-tier role may edit pages, content tags may not", opts, async () => {
  await withSite([], async (ws, cookieFor) => {
    for (const role of ["author", "editor", "admin"]) {
      assertEquals((await ws(await cookieFor(role))).status, 204, role);
    }
    assertEquals((await ws(await cookieFor("subscriber"))).status, 403);
  });
});

Deno.test("a role granted through a plugin's user store while the app runs applies at once", opts, async () => {
  await withSite([], async (ws, cookieFor, { services, ids }) => {
    const cookie = await cookieFor("subscriber");
    assertEquals((await ws(cookie)).status, 403);

    // What an admin plugin does: write the role through services.users.
    const users = services.users.createLocalStore({ usersDir: "data/users" });
    await users.update(ids.get("subscriber")!, { roles: ["editor"] });
    assertEquals((await ws(cookie)).status, 204);

    await users.update(ids.get("subscriber")!, { roles: ["subscriber"] });
    assertEquals((await ws(cookie)).status, 403);
  });
});
