/**
 * The editor resolver: who is editing a request, and whether they may.
 *
 * One decision for the bar, the inline-edit WebSocket and /api/inline-edit/*:
 * a site user or the `editor.session` provider's user, holding `pages.update`
 * by `authz.check()`, which is the sole authority and fails closed.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createEditorResolver } from "../../src/auth/editor.ts";
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
    authenticate: () => Promise.resolve(user ? { authenticated: true, user } : { authenticated: false }),
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
  const authz = makeAuthz(true);
  const resolve = createEditorResolver({ capabilities: caps(), siteAuthz: () => authz, sessionAuthz: () => undefined });
  const r = await resolve(siteRequest({ id: "u1", roles: ["editor"], email: "e@x.test", name: "Ed" }));
  assertEquals(r, { ok: true, editor: { id: "u1", username: "Ed", roles: ["editor"], source: "site" } });
  assertEquals((authz.calls[0] as { onWhat: unknown }).onWhat, { type: "app", id: "site" });
});

Deno.test("editor: a site user the authz system denies is 403, and so is one when there is no authz system", async () => {
  const denied = createEditorResolver({
    capabilities: caps(),
    siteAuthz: () => makeAuthz(false),
    sessionAuthz: () => undefined,
  });
  assertEquals(await denied(siteRequest({ id: "u1", roles: ["editor"] })), { ok: false, status: 403 });
  const none = createEditorResolver({ capabilities: caps(), siteAuthz: () => undefined, sessionAuthz: () => undefined });
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
  assertEquals(r, { ok: true, editor: { id: "a1", username: "ada", roles: ["admin"], source: "session" } });
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
  assertEquals(await resolve(new Request("https://site.test/", { headers: { cookie: "other=1" } })), {
    ok: false,
    status: 401,
  });
  assertEquals(asked, 0);
});

Deno.test("editor: an invalid session, a failing provider and a missing provider are all 401", async () => {
  const mk = (p?: ReturnType<typeof provider>) =>
    createEditorResolver({ capabilities: caps(p), siteAuthz: () => undefined, sessionAuthz: () => makeAuthz(true) });
  const withCookie = new Request("https://site.test/", { headers: { cookie: "sid=x" } });
  assertEquals(await mk(provider(null, ["sid"]))(withCookie), { ok: false, status: 401 });
  const throwing = { sessionCookies: ["sid"], authenticate: () => Promise.reject(new Error("store down")) };
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
