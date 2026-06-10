/**
 * Tests for the plugin response-transform pipeline wiring.
 *
 * Covers the security invariants restored in the v0.17 audit:
 * - auth is non-null only for sessions holding pages.update (F1)
 * - admin-panel paths are never transformed (F4)
 * - anonymous requests reach plugins with auth: null and no session lookup
 */

import { assertEquals, assertStrictEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { runPluginResponseTransforms } from "../../src/cli/response-transforms.ts";
import type { DunePlugin, ResponseTransformContext } from "../../src/hooks/types.ts";
import type { DuneConfig } from "../../src/config/types.ts";
import type { AdminUser, AuthResult, AdminPermission } from "../../src/admin/types.ts";

const config = {} as DuneConfig;

function makeUser(role: AdminUser["role"]): AdminUser {
  return {
    id: "u1",
    username: "alice",
    email: "alice@example.com",
    passwordHash: "",
    role,
    name: "Alice",
    createdAt: 0,
    updatedAt: 0,
    enabled: true,
  };
}

/** Fake auth middleware with a fixed outcome and call counter. */
function makeAuth(opts: {
  result?: AuthResult;
  permissions?: AdminPermission[];
  throws?: boolean;
}) {
  const calls = { authenticate: 0 };
  return {
    calls,
    authenticate(_req: Request): Promise<AuthResult> {
      calls.authenticate++;
      if (opts.throws) return Promise.reject(new Error("session store down"));
      return Promise.resolve(opts.result ?? { authenticated: false, error: "No session cookie" });
    },
    hasPermission(authResult: AuthResult, permission: AdminPermission): boolean {
      if (!authResult.authenticated || !authResult.user) return false;
      return (opts.permissions ?? []).includes(permission);
    },
  };
}

/** Plugin that records the context it received and tags the response body. */
function makeRecordingPlugin(name = "recorder") {
  const seen: ResponseTransformContext[] = [];
  const plugin: DunePlugin = {
    name,
    version: "1.0.0",
    hooks: {},
    async transformResponse(ctx) {
      seen.push(ctx);
      const body = await ctx.response.text();
      return new Response(`${body}+${name}`, {
        status: ctx.response.status,
        headers: ctx.response.headers,
      });
    },
  };
  return { plugin, seen };
}

const pages = [
  { route: "/about", sourcePath: "content/about.md", title: "About" },
];

function makeReq(path: string, cookie?: string): Request {
  return new Request(`http://localhost${path}`, {
    headers: cookie ? { cookie } : undefined,
  });
}

const SESSION_COOKIE = "dune_session=abc123";

Deno.test("runPluginResponseTransforms: no transform plugins — response untouched, no auth call", async () => {
  const auth = makeAuth({});
  const original = new Response("hello");
  const result = await runPluginResponseTransforms({
    req: makeReq("/about", SESSION_COOKIE),
    response: original,
    plugins: [{ name: "noop", version: "1.0.0", hooks: {} }],
    auth,
    pages,
    config,
    adminPrefix: "/admin",
  });
  assertStrictEquals(result, original);
  assertEquals(auth.calls.authenticate, 0);
});

Deno.test("runPluginResponseTransforms: anonymous request — plugin runs with auth null, no session lookup", async () => {
  const auth = makeAuth({});
  const { plugin, seen } = makeRecordingPlugin();
  const result = await runPluginResponseTransforms({
    req: makeReq("/about"),
    response: new Response("hello"),
    plugins: [plugin],
    auth,
    pages,
    config,
    adminPrefix: "/admin",
  });
  assertEquals(await result.text(), "hello+recorder");
  assertEquals(seen[0].auth, null);
  assertEquals(seen[0].page?.sourcePath, "content/about.md");
  assertEquals(auth.calls.authenticate, 0);
});

Deno.test("runPluginResponseTransforms: valid session WITHOUT pages.update — auth is null (F1)", async () => {
  const auth = makeAuth({
    result: { authenticated: true, user: makeUser("author") },
    permissions: ["pages.read"] as AdminPermission[],
  });
  const { plugin, seen } = makeRecordingPlugin();
  await runPluginResponseTransforms({
    req: makeReq("/about", SESSION_COOKIE),
    response: new Response("hello"),
    plugins: [plugin],
    auth,
    pages,
    config,
    adminPrefix: "/admin",
  });
  assertEquals(auth.calls.authenticate, 1);
  assertEquals(seen[0].auth, null);
});

Deno.test("runPluginResponseTransforms: valid session WITH pages.update — auth populated", async () => {
  const auth = makeAuth({
    result: { authenticated: true, user: makeUser("editor") },
    permissions: ["pages.read", "pages.update"] as AdminPermission[],
  });
  const { plugin, seen } = makeRecordingPlugin();
  await runPluginResponseTransforms({
    req: makeReq("/about", SESSION_COOKIE),
    response: new Response("hello"),
    plugins: [plugin],
    auth,
    pages,
    config,
    adminPrefix: "/admin",
  });
  const ctxAuth = seen[0].auth;
  assertEquals(ctxAuth?.username, "alice");
  assertEquals(ctxAuth?.role, "editor");
  assertEquals(ctxAuth?.hasPermission("pages.update"), true);
  assertEquals(ctxAuth?.hasPermission("users.manage"), false);
});

Deno.test("runPluginResponseTransforms: admin paths are never transformed (F4)", async () => {
  const auth = makeAuth({
    result: { authenticated: true, user: makeUser("admin") },
    permissions: ["pages.update"] as AdminPermission[],
  });
  const { plugin, seen } = makeRecordingPlugin();
  for (const path of ["/admin", "/admin/pages", "/admin/api/content/x"]) {
    const original = new Response("admin html");
    const result = await runPluginResponseTransforms({
      req: makeReq(path, SESSION_COOKIE),
      response: original,
      plugins: [plugin],
      auth,
      pages,
      config,
      adminPrefix: "/admin",
    });
    assertStrictEquals(result, original);
  }
  assertEquals(seen.length, 0);
  // Prefix match must not over-block sibling routes like /administrivia.
  const sibling = await runPluginResponseTransforms({
    req: makeReq("/administrivia"),
    response: new Response("page"),
    plugins: [plugin],
    auth,
    pages,
    config,
    adminPrefix: "/admin",
  });
  assertEquals(await sibling.text(), "page+recorder");
});

Deno.test("runPluginResponseTransforms: auth backend failure — treated as unauthenticated", async () => {
  const auth = makeAuth({ throws: true });
  const { plugin, seen } = makeRecordingPlugin();
  const result = await runPluginResponseTransforms({
    req: makeReq("/about", SESSION_COOKIE),
    response: new Response("hello"),
    plugins: [plugin],
    auth,
    pages,
    config,
    adminPrefix: "/admin",
  });
  assertEquals(await result.text(), "hello+recorder");
  assertEquals(seen[0].auth, null);
});

Deno.test("runPluginResponseTransforms: non-content route — page is null", async () => {
  const auth = makeAuth({});
  const { plugin, seen } = makeRecordingPlugin();
  await runPluginResponseTransforms({
    req: makeReq("/no-such-page"),
    response: new Response("404 html", { status: 404 }),
    plugins: [plugin],
    auth,
    pages,
    config,
    adminPrefix: "/admin",
  });
  assertEquals(seen[0].page, null);
});

Deno.test("runPluginResponseTransforms: transforms compose in registration order", async () => {
  const auth = makeAuth({});
  const a = makeRecordingPlugin("a");
  const b = makeRecordingPlugin("b");
  const result = await runPluginResponseTransforms({
    req: makeReq("/about"),
    response: new Response("x"),
    plugins: [a.plugin, b.plugin],
    auth,
    pages,
    config,
    adminPrefix: "/admin",
  });
  assertEquals(await result.text(), "x+a+b");
});
