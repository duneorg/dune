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
import type { AdminUser, AuthResult, AdminPermission } from "jsr:@dune/plugin-admin/admin/types";

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
  {
    route: "/about",
    sourcePath: "content/about.md",
    title: "About",
    language: "en",
  },
];

function makeReq(path: string, cookie?: string): Request {
  return new Request(`http://localhost${path}`, {
    headers: cookie ? { cookie } : undefined,
  });
}

const SESSION_COOKIE = "dune_session=abc123";

function htmlResponse(body: string): Response {
  return new Response(body, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

Deno.test("runPluginResponseTransforms: no transform plugins, anonymous — non-HTML untouched, no auth call", async () => {
  const auth = makeAuth({});
  const original = new Response("hello");
  const result = await runPluginResponseTransforms({
    req: makeReq("/about"),
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

Deno.test("runPluginResponseTransforms: no transform plugins, session cookie — auth still resolved for the scrub decision", async () => {
  const auth = makeAuth({});
  const result = await runPluginResponseTransforms({
    req: makeReq("/about", SESSION_COOKIE),
    response: htmlResponse(`<div data-dune-body data-dune-source="content/about.md">x</div>`),
    plugins: [{ name: "noop", version: "1.0.0", hooks: {} }],
    auth,
    pages,
    config,
    adminPrefix: "/admin",
  });
  // Invalid session → markers scrubbed despite the cookie.
  assertEquals(auth.calls.authenticate, 1);
  assertEquals(await result.text(), `<div>x</div>`);
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

// ── Marker scrub policy ───────────────────────────────────────────────────────

const MARKED_HTML =
  `<h1 data-dune-field="title" data-dune-source="content/about.md">About</h1>` +
  `<div data-dune-body data-dune-source="content/about.md">body</div>`;

Deno.test("marker scrub: anonymous HTML response loses all data-dune-* attributes", async () => {
  const auth = makeAuth({});
  const result = await runPluginResponseTransforms({
    req: makeReq("/about"),
    response: htmlResponse(MARKED_HTML),
    plugins: [],
    auth,
    pages,
    config,
    adminPrefix: "/admin",
  });
  assertEquals(await result.text(), `<h1>About</h1><div>body</div>`);
  assertEquals(auth.calls.authenticate, 0);
});

Deno.test("marker scrub: forged/invalid session cookie still gets scrubbed", async () => {
  const auth = makeAuth({ result: { authenticated: false, error: "bad session" } });
  const result = await runPluginResponseTransforms({
    req: makeReq("/about", "dune_session=forged"),
    response: htmlResponse(MARKED_HTML),
    plugins: [],
    auth,
    pages,
    config,
    adminPrefix: "/admin",
  });
  assertEquals(auth.calls.authenticate, 1);
  assertEquals(await result.text(), `<h1>About</h1><div>body</div>`);
});

Deno.test("marker scrub: valid session WITHOUT pages.update gets scrubbed", async () => {
  const auth = makeAuth({
    result: { authenticated: true, user: makeUser("author") },
    permissions: ["pages.read"] as AdminPermission[],
  });
  const result = await runPluginResponseTransforms({
    req: makeReq("/about", SESSION_COOKIE),
    response: htmlResponse(MARKED_HTML),
    plugins: [],
    auth,
    pages,
    config,
    adminPrefix: "/admin",
  });
  assertEquals(await result.text(), `<h1>About</h1><div>body</div>`);
});

Deno.test("marker scrub: valid editing session keeps markers", async () => {
  const auth = makeAuth({
    result: { authenticated: true, user: makeUser("editor") },
    permissions: ["pages.update"] as AdminPermission[],
  });
  const result = await runPluginResponseTransforms({
    req: makeReq("/about", SESSION_COOKIE),
    response: htmlResponse(MARKED_HTML),
    plugins: [],
    auth,
    pages,
    config,
    adminPrefix: "/admin",
  });
  assertEquals(await result.text(), MARKED_HTML);
});

Deno.test("marker scrub: runs after plugin transforms for anonymous requests", async () => {
  const auth = makeAuth({});
  const plugin: DunePlugin = {
    name: "marker-adder",
    version: "1.0.0",
    hooks: {},
    async transformResponse(ctx) {
      const body = await ctx.response.text();
      return new Response(`${body}<span data-dune-field="x" data-dune-source="s.md">v</span>`, {
        status: ctx.response.status,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    },
  };
  const result = await runPluginResponseTransforms({
    req: makeReq("/about"),
    response: htmlResponse(`<p>p</p>`),
    plugins: [plugin],
    auth,
    pages,
    config,
    adminPrefix: "/admin",
  });
  // Even markers introduced by a transform are stripped for anonymous visitors.
  assertEquals(await result.text(), `<p>p</p><span>v</span>`);
});
