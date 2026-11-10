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
      // Echo what core handed over, so the tests can see the gate's output.
      handleRequest: async (req: Request, ctx: {
        editor: unknown;
        path: string;
        pageFrontmatter(p: string): Promise<unknown>;
      }) =>
        Response.json({
          method: req.method,
          editor: ctx.editor,
          path: ctx.path,
          title: (await ctx.pageFrontmatter("01.home/default.md") as { title?: string } | null)?.title ?? null,
          missing: await ctx.pageFrontmatter("nope/default.md"),
        }),
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

const ROLES = ["author", "editor", "admin", "member", "subscriber", "staff"];

/**
 * Run `fn` against a site with a login and one existing user per role. The
 * users exist before the site starts because that is when site auth seeds
 * their group membership.
 */
async function withSite(
  plugins: DunePlugin[],
  fn: (
    ws: (cookie?: string, path?: string) => Promise<Response>,
    cookieFor: (role: string) => Promise<string>,
    plugin: { services: Awaited<ReturnType<typeof bootstrap>>["pluginServices"]; ids: Map<string, string> },
  ) => Promise<void>,
  systemYaml?: string,
) {
  const root = await Deno.makeTempDir({ prefix: "dune_test_site_user_editing_" });
  try {
    await Deno.mkdir(join(root, "content", "01.home"), { recursive: true });
    await Deno.writeTextFile(join(root, "content", "01.home", "default.md"), "---\ntitle: Home\n---\n\nHi\n");
    await Deno.mkdir(join(root, "config"), { recursive: true });
    if (systemYaml) await Deno.writeTextFile(join(root, "config", "system.yaml"), systemYaml);
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
    // A page the "editor" user created (it only matters when "editor" is remapped to author).
    await Deno.mkdir(join(root, "content", "03.editors"), { recursive: true });
    await Deno.writeTextFile(
      join(root, "content", "03.editors", "default.md"),
      `---\ntitle: Editors\ncreatedBy: ${ids.get("editor")}\n---\n\nEditors\n`,
    );
    // A page the author created: authors edit their own pages, not others'.
    await Deno.mkdir(join(root, "content", "02.mine"), { recursive: true });
    await Deno.writeTextFile(
      join(root, "content", "02.mine", "default.md"),
      `---\ntitle: Mine\ncreatedBy: ${ids.get("author")}\n---\n\nMine\n`,
    );
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
    const ws = (cookie?: string, path = "01.home/default.md") =>
      handler(
        new Request(`http://localhost/api/inline-edit/ws?path=${path}`, {
          headers: {
            upgrade: "websocket",
            origin: "http://localhost",
            ...(cookie ? { cookie } : {}),
          },
        }),
      );
    http = (path, init, cookie) =>
      handler(
        new Request(`http://localhost/api/inline-edit/${path}`, {
          ...init,
          headers: { ...(init.headers as Record<string, string> | undefined), ...(cookie ? { cookie } : {}) },
        }),
      );
    await fn(ws, cookieFor, { services: ctx.pluginServices, ids });
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
}

let http: (path: string, init: RequestInit, cookie?: string) => Promise<Response>;

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
    for (const role of ["editor", "admin"]) {
      assertEquals((await ws(await cookieFor(role))).status, 204, role);
    }
    assertEquals((await ws(await cookieFor("subscriber"))).status, 403);
  });
});

Deno.test("an author joins a live session only on a page they created", opts, async () => {
  await withSite([], async (ws, cookieFor) => {
    const author = await cookieFor("author");
    assertEquals((await ws(author, "02.mine/default.md")).status, 204);
    assertEquals((await ws(author, "01.home/default.md")).status, 403);
    // An editor is not limited to their own pages.
    assertEquals((await ws(await cookieFor("editor"), "02.mine/default.md")).status, 204);
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

Deno.test("/api/inline-edit/*: core resolves the editor, then hands the request to the provider", opts, async () => {
  await withSite([], async (_ws, cookieFor, { ids }) => {
    const cookie = await cookieFor("editor");
    const res = await http("content/01.home%2Fdefault.md/source", { method: "GET" }, cookie);
    assertEquals(res.status, 200);
    assertEquals(await res.json(), {
      method: "GET",
      editor: { id: ids.get("editor"), username: "editor@example.com", roles: ["editor"], relation: "editor", source: "site" },
      path: "content/01.home%2Fdefault.md/source",
      title: "Home",
      missing: null,
    });
  });
});

Deno.test("/api/inline-edit/*: 401 without a login, 403 for a user who may not edit, nothing reaches the provider", opts, async () => {
  await withSite([], async (_ws, cookieFor) => {
    assertEquals((await http("content/x/source", { method: "GET" })).status, 401);
    assertEquals((await http("content/x/source", { method: "GET" }, await cookieFor("member"))).status, 403);
  });
});

Deno.test("/api/inline-edit/*: a write needs a same-origin request", opts, async () => {
  await withSite([], async (_ws, cookieFor) => {
    const cookie = await cookieFor("editor");
    const write = (headers: Record<string, string>) =>
      http("content/x/commit", { method: "POST", headers }, cookie);
    assertEquals((await write({})).status, 403);
    assertEquals((await write({ origin: "http://evil.test" })).status, 403);
    assertEquals((await write({ origin: "http://localhost" })).status, 200);
  });
});

Deno.test("system.role_grants: a remapped group edits, the default one no longer does; {} switches the grants off", opts, async () => {
  await withSite([], async (ws, cookieFor) => {
    assertEquals((await ws(await cookieFor("staff"))).status, 204);
    assertEquals((await ws(await cookieFor("editor"))).status, 403, "'editor' is a content tier on this site");
    assertEquals((await ws(await cookieFor("member"))).status, 403);
  }, "role_grants:\n  staff: editor\n");

  await withSite([], async (ws, cookieFor) => {
    for (const role of ["author", "editor", "admin", "staff"]) {
      assertEquals((await ws(await cookieFor(role))).status, 403, role);
    }
  }, "role_grants: {}\n");
});

Deno.test("system.role_grants: a default-named group remapped DOWN keeps the own-pages-only limit at the socket", opts, async () => {
  await withSite([], async (ws, cookieFor) => {
    // "editor" is a content tier here, mapped to author: its users edit their own pages only.
    const editor = await cookieFor("editor");
    assertEquals((await ws(editor, "03.editors/default.md")).status, 204, "a page it created");
    assertEquals((await ws(editor, "01.home/default.md")).status, 403, "someone else's page");
    assertEquals((await ws(editor, "02.mine/default.md")).status, 403, "the author's page");
    // "author" is no longer mapped to anything, so that role grants nothing.
    assertEquals((await ws(await cookieFor("author"), "02.mine/default.md")).status, 403);
  }, "role_grants:\n  editor: author\n");
});
