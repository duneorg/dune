/**
 * The editor resolver: who is editing a request, and whether they may.
 *
 * One decision for the bar, the inline-edit WebSocket and /api/inline-edit/*:
 * a site user or the `editor.session` provider's user, holding `pages.update`
 * by `authz.check()`, which is the sole authority and fails closed.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createEditorResolver, mayEditPage } from "../../src/auth/editor.ts";
import type { DuneAuthSystem } from "../../src/auth/authz.ts";
import { USER_HEADER } from "../../src/auth/types.ts";

function makeAuthz(allowed: boolean) {
  const calls: unknown[] = [];
  return {
    calls,
    // deno-lint-ignore no-explicit-any
    check(args: any): Promise<boolean> {
      calls.push(args);
      return Promise.resolve(allowed);
    },
  } as unknown as DuneAuthSystem & { calls: unknown[] };
}

function provider(user: Record<string, unknown> | null, cookies?: string[]) {
  return {
    sessionCookies: cookies,
    authenticate: () =>
      Promise.resolve(user ? { authenticated: true, user } : { authenticated: false }),
  };
}

function caps(p?: ReturnType<typeof provider>) {
  return {
    get: (name: string) => (name === "editor.session" ? p : undefined),
    list: () => [],
    providers: () => [],
    // deno-lint-ignore no-explicit-any
  } as any;
}

function siteRequest(user: Record<string, unknown>): Request {
  return new Request("https://site.test/", { headers: { [USER_HEADER]: JSON.stringify(user) } });
}

Deno.test("editor: a site user holding pages.update is an editor, named by username, then name, then email", async () => {
  // This fake authz says yes to everything, so the relation read from it is the highest, whatever the role is called.
  const authz = makeAuthz(true);
  const resolve = createEditorResolver({
    capabilities: caps(),
    siteAuthz: () => authz,
    sessionAuthz: () => undefined,
  });
  const r = await resolve(
    siteRequest({ id: "u1", roles: ["editor"], email: "e@x.test", name: "Ed" }),
  );
  assertEquals(r, {
    ok: true,
    editor: { id: "u1", username: "Ed", roles: ["editor"], relation: "admin", source: "site" },
  });
  assertEquals((authz.calls[0] as { onWhat: unknown }).onWhat, { type: "app", id: "site" });
});

Deno.test("editor: a site user the authz system denies is 403, and so is one when there is no authz system", async () => {
  const denied = createEditorResolver({
    capabilities: caps(),
    siteAuthz: () => makeAuthz(false),
    sessionAuthz: () => undefined,
  });
  assertEquals(await denied(siteRequest({ id: "u1", roles: ["editor"] })), {
    ok: false,
    status: 403,
  });
  const none = createEditorResolver({
    capabilities: caps(),
    siteAuthz: () => undefined,
    sessionAuthz: () => undefined,
  });
  assertEquals(await none(siteRequest({ id: "u1", roles: ["admin"] })), { ok: false, status: 403 });
});

Deno.test("editor: a session-provider user is an editor when authz allows; the site's authz system is not consulted for them", async () => {
  const site = makeAuthz(false);
  const session = makeAuthz(true);
  const resolve = createEditorResolver({
    capabilities: caps(provider({ id: "a1", username: "ada", roles: ["admin"] }, ["sid"])),
    siteAuthz: () => site,
    sessionAuthz: () => session,
  });
  const r = await resolve(new Request("https://site.test/", { headers: { cookie: "sid=abc" } }));
  assertEquals(r, {
    ok: true,
    editor: { id: "a1", username: "ada", roles: ["admin"], relation: "admin", source: "session" },
  });
  assertEquals(site.calls.length, 0);
});

Deno.test("editor: no site user and no session cookie is 401 without asking the provider", async () => {
  let asked = 0;
  const p = provider({ id: "a1", roles: ["admin"] }, ["sid"]);
  const counting = { ...p, authenticate: () => (asked++, p.authenticate()) };
  const resolve = createEditorResolver({
    capabilities: caps(counting),
    siteAuthz: () => makeAuthz(true),
    sessionAuthz: () => makeAuthz(true),
  });
  assertEquals(
    await resolve(new Request("https://site.test/", { headers: { cookie: "other=1" } })),
    {
      ok: false,
      status: 401,
    },
  );
  assertEquals(asked, 0);
});

Deno.test("editor: an invalid session, a failing provider and a missing provider are all 401", async () => {
  const mk = (p?: ReturnType<typeof provider>) =>
    createEditorResolver({
      capabilities: caps(p),
      siteAuthz: () => undefined,
      sessionAuthz: () => makeAuthz(true),
    });
  const withCookie = new Request("https://site.test/", { headers: { cookie: "sid=x" } });
  assertEquals(await mk(provider(null, ["sid"]))(withCookie), { ok: false, status: 401 });
  const throwing = {
    sessionCookies: ["sid"],
    authenticate: () => Promise.reject(new Error("store down")),
  };
  // deno-lint-ignore no-explicit-any
  assertEquals(await mk(throwing as any)(withCookie), { ok: false, status: 401 });
  assertEquals(await mk(undefined)(withCookie), { ok: false, status: 401 });
});

Deno.test("editor: a session user without pages.update is 403", async () => {
  const resolve = createEditorResolver({
    capabilities: caps(provider({ id: "a1", roles: [] }, ["sid"])),
    siteAuthz: () => undefined,
    sessionAuthz: () => makeAuthz(false),
  });
  const r = await resolve(new Request("https://site.test/", { headers: { cookie: "sid=x" } }));
  assertEquals(r, { ok: false, status: 403 });
});

Deno.test("mayEditPage: admin and editor relations edit any page; an author only the pages it created; no page, no edit", () => {
  const page = { createdBy: "a1" };
  assertEquals(mayEditPage({ id: "x", relation: "admin" }, page), true);
  assertEquals(mayEditPage({ id: "x", relation: "editor" }, page), true);
  assertEquals(mayEditPage({ id: "a1", relation: "author" }, page), true);
  assertEquals(mayEditPage({ id: "a2", relation: "author" }, page), false);
  assertEquals(mayEditPage({ id: "a1", relation: "author" }, {}), false);
  assertEquals(mayEditPage({ id: "x", relation: "admin" }, null), false);
});

// ── The relation is what authz says the user holds, not what their role is called ──

import { createStorage } from "../../src/storage/mod.ts";
import { bootstrapRoleGrants, createDuneAuthSystem } from "../../src/auth/authz.ts";
import {
  DUNE_BASE_AUTHZ_ACTIONS,
  RELATION_PROBE_ACTIONS,
  SITE_RESOURCE,
} from "../../src/auth/authz-schema.ts";
import type { RoleGrants } from "../../src/auth/role-grants.ts";

Deno.test("the relation probes tell the three relations apart in the built-in schema", () => {
  assertEquals([...DUNE_BASE_AUTHZ_ACTIONS[RELATION_PROBE_ACTIONS.admin]], ["admin"]);
  assertEquals([...DUNE_BASE_AUTHZ_ACTIONS[RELATION_PROBE_ACTIONS.editor]], ["admin", "editor"]);
  assertEquals([...DUNE_BASE_AUTHZ_ACTIONS["pages.update"]], ["admin", "editor", "author"]);
});

async function relationUnder(
  grants: RoleGrants,
  roles: string[],
  direct?: "admin" | "editor" | "author",
) {
  const root = await Deno.makeTempDir({ prefix: "dune_test_editor_relation_" });
  try {
    const { authz, adapter } = createDuneAuthSystem(
      { authzStore: "local", dataDir: "data" },
      createStorage({ rootDir: root }),
    );
    await bootstrapRoleGrants(authz, adapter, grants);
    for (const role of roles) {
      await authz.addMember({
        member: { type: "user", id: "u1" },
        group: { type: "group", id: role },
      });
    }
    if (direct) {
      await authz.allow({ who: { type: "user", id: "u1" }, toBe: direct, onWhat: SITE_RESOURCE });
    }
    const resolve = createEditorResolver({
      capabilities: caps(),
      siteAuthz: () => authz,
      sessionAuthz: () => undefined,
    });
    const r = await resolve(siteRequest({ id: "u1", roles }));
    return r.ok ? r.editor.relation : r.status;
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
}

const DEFAULTS: RoleGrants = { admin: "admin", editor: "editor", author: "author" };

Deno.test("with the default grants each role holds its own relation", async () => {
  assertEquals(await relationUnder(DEFAULTS, ["admin"]), "admin");
  assertEquals(await relationUnder(DEFAULTS, ["member", "editor"]), "editor");
  assertEquals(await relationUnder(DEFAULTS, ["author"]), "author");
});

Deno.test("a remap to a LOWER relation lowers the reported relation (editor -> author, admin -> editor)", async () => {
  assertEquals(await relationUnder({ editor: "author" }, ["editor"]), "author");
  assertEquals(await relationUnder({ admin: "editor" }, ["admin"]), "editor");
  // and the author limit then applies: an author edits only the pages it created.
  assertEquals(mayEditPage({ id: "u1", relation: "author" }, { createdBy: "someone-else" }), false);
});

Deno.test("a remap to a higher relation, or of an own group, raises it", async () => {
  assertEquals(await relationUnder({ staff: "editor" }, ["staff"]), "editor");
  assertEquals(await relationUnder({ author: "admin" }, ["author"]), "admin");
});

Deno.test("an account with a direct tuple holds what the tuple says, whatever its groups say; the highest of both wins", async () => {
  assertEquals(await relationUnder({}, ["admin"], "admin"), "admin");
  assertEquals(await relationUnder({ editor: "author" }, ["editor"], "editor"), "editor");
});

Deno.test("with the grants off and no direct tuple a role grants nothing", async () => {
  assertEquals(await relationUnder({}, ["editor"]), 403);
});
