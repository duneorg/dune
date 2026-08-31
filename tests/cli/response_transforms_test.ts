/**
 * Tests for the plugin response-transform pipeline wiring.
 *
 * Covers the security invariants restored in the v0.17 audit:
 * - auth is non-null only for sessions holding pages.update (F1)
 * - admin-panel paths are never transformed (F4)
 * - anonymous requests reach plugins with auth: null and no session lookup
 */

import {
  assertEquals,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { runPluginResponseTransforms } from "../../src/cli/response-transforms.ts";
import type {
  DunePlugin,
  ResponseTransformContext,
} from "../../src/hooks/types.ts";
import type { DuneConfig } from "../../src/config/types.ts";
import type {
  AuthResult,
  User,
} from "jsr:@dune/plugin-admin/admin/types";

const config = {} as DuneConfig;

function makeUser(role: string): User {
  return {
    id: "u1",
    username: "alice",
    email: "alice@example.com",
    passwordHash: "",
    provider: "local",
    roles: [role],
    name: "Alice",
    createdAt: 0,
    updatedAt: 0,
    lastSeenAt: 0,
    enabled: true,
  };
}

/**
 * Fake auth middleware with a fixed outcome and call counter. `authenticate()`
 * is the only method the real interface has since ROLE_PERMISSIONS/
 * hasPermission() were removed (dec-identity-unification Phase 5c/6) —
 * permission decisions go through `makeAuthz()` below instead.
 */
function makeAuth(opts: {
  result?: AuthResult;
  throws?: boolean;
}) {
  const calls = { authenticate: 0 };
  return {
    calls,
    authenticate(_req: Request): Promise<AuthResult> {
      calls.authenticate++;
      if (opts.throws) return Promise.reject(new Error("session store down"));
      return Promise.resolve(
        opts.result ?? { authenticated: false, error: "No session cookie" },
      );
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
    template: "post",
  },
];

/**
 * Minimal stand-in for `engine.router.resolve` — exact route match only, no
 * home-page/alias/multilingual handling (those are the real resolver's job,
 * covered separately; this pipeline just needs *some* resolver to call).
 */
function resolveFor(pageList: typeof pages) {
  return (pathname: string) => {
    const page = pageList.find((p) => p.route === pathname);
    return page ? { type: "page" as const, page } : null;
  };
}

const resolve = resolveFor(pages);

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
    resolve,
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
    response: htmlResponse(
      `<div data-dune-body data-dune-source="content/about.md">x</div>`,
    ),
    plugins: [{ name: "noop", version: "1.0.0", hooks: {} }],
    auth,
    resolve,
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
    resolve,
    config,
    adminPrefix: "/admin",
  });
  assertEquals(await result.text(), "hello+recorder");
  assertEquals(seen[0].auth, null);
  assertEquals(seen[0].page?.sourcePath, "content/about.md");
  assertEquals(auth.calls.authenticate, 0);
});

Deno.test("runPluginResponseTransforms: valid session, no authz — auth is null (F1, fails closed)", async () => {
  const auth = makeAuth({
    result: { authenticated: true, user: makeUser("author") },
  });
  const { plugin, seen } = makeRecordingPlugin();
  await runPluginResponseTransforms({
    req: makeReq("/about", SESSION_COOKIE),
    response: new Response("hello"),
    plugins: [plugin],
    auth,
    resolve,
    config,
    adminPrefix: "/admin",
  });
  assertEquals(auth.calls.authenticate, 1);
  assertEquals(seen[0].auth, null);
});

Deno.test("runPluginResponseTransforms: valid session WITH pages.update — auth populated", async () => {
  const auth = makeAuth({
    result: { authenticated: true, user: makeUser("editor") },
  });
  // deno-lint-ignore no-explicit-any
  const authz = makeAuthz(true) as any;
  const { plugin, seen } = makeRecordingPlugin();
  await runPluginResponseTransforms({
    req: makeReq("/about", SESSION_COOKIE),
    response: new Response("hello"),
    plugins: [plugin],
    auth,
    authz,
    resolve,
    config,
    adminPrefix: "/admin",
  });
  const ctxAuth = seen[0].auth;
  assertEquals(ctxAuth?.username, "alice");
  assertEquals(ctxAuth?.role, "editor");
  // hasPermission() is a synchronous read of the canonical actionToRelations
  // schema (roleHasPermission()), not a re-consultation of authz.check() —
  // "editor" grants pages.update but not the admin-only users.manage.
  assertEquals(ctxAuth?.hasPermission("pages.update"), true);
  assertEquals(ctxAuth?.hasPermission("pages.delete"), false);
});

Deno.test("runPluginResponseTransforms: roles[] mixing tags and admin roles — highest admin-tier role wins", async () => {
  // A merged User's roles[] can hold content-gating tags alongside the
  // admin-tier role, in no guaranteed order. roles[0] ("member") used to
  // become ctx.auth.role — under-privileging hasPermission() relative to
  // what authz.check() decided just above.
  const auth = makeAuth({
    result: {
      authenticated: true,
      // deno-lint-ignore no-explicit-any
      user: { ...makeUser("admin"), roles: ["member", "admin"] } as any,
    },
  });
  // deno-lint-ignore no-explicit-any
  const authz = makeAuthz(true) as any;
  const { plugin, seen } = makeRecordingPlugin();
  await runPluginResponseTransforms({
    req: makeReq("/about", SESSION_COOKIE),
    response: new Response("hello"),
    plugins: [plugin],
    auth,
    authz,
    resolve,
    config,
    adminPrefix: "/admin",
  });
  const ctxAuth = seen[0].auth;
  assertEquals(ctxAuth?.role, "admin");
  assertEquals(ctxAuth?.hasPermission("pages.update"), true);
  assertEquals(ctxAuth?.hasPermission("users.manage"), true);
});

Deno.test("runPluginResponseTransforms: admin paths are never transformed (F4)", async () => {
  const auth = makeAuth({
    result: { authenticated: true, user: makeUser("admin") },
  });
  const { plugin, seen } = makeRecordingPlugin();
  for (const path of ["/admin", "/admin/pages", "/admin/api/content/x"]) {
    const original = new Response("admin html");
    const result = await runPluginResponseTransforms({
      req: makeReq(path, SESSION_COOKIE),
      response: original,
      plugins: [plugin],
      auth,
      resolve,
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
    resolve,
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
    resolve,
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
    resolve,
    config,
    adminPrefix: "/admin",
  });
  assertEquals(seen[0].page, null);
});

// ── authz-first permission check (dec-identity-unification Phase 7) ─────────────
//
// The `pages.update` gate is `authz.check()`, full stop — same sole-authority
// contract as every other admin permission check (Phase 5c/6). No fallback
// table to compare against anymore; these just prove authz's answer is what
// actually governs `auth` in the returned context.

function makeAuthz(allowed: boolean) {
  const calls = { check: 0 };
  return {
    calls,
    // deno-lint-ignore no-explicit-any
    check(_args: any): Promise<boolean> {
      calls.check++;
      return Promise.resolve(allowed);
    },
  };
}

Deno.test("runPluginResponseTransforms: authz.check() allowing grants access", async () => {
  const auth = makeAuth({
    result: { authenticated: true, user: makeUser("author") },
  });
  // deno-lint-ignore no-explicit-any
  const authz = makeAuthz(true) as any;
  const { plugin, seen } = makeRecordingPlugin();
  await runPluginResponseTransforms({
    req: makeReq("/about", SESSION_COOKIE),
    response: new Response("hello"),
    plugins: [plugin],
    auth,
    authz,
    resolve,
    config,
    adminPrefix: "/admin",
  });
  assertEquals(authz.calls.check, 1);
  assertEquals(seen[0].auth?.username, "alice");
});

Deno.test("runPluginResponseTransforms: authz.check() denying blocks access", async () => {
  const auth = makeAuth({
    result: { authenticated: true, user: makeUser("editor") },
  });
  // deno-lint-ignore no-explicit-any
  const authz = makeAuthz(false) as any;
  const { plugin, seen } = makeRecordingPlugin();
  await runPluginResponseTransforms({
    req: makeReq("/about", SESSION_COOKIE),
    response: new Response("hello"),
    plugins: [plugin],
    auth,
    authz,
    resolve,
    config,
    adminPrefix: "/admin",
  });
  assertEquals(authz.calls.check, 1);
  assertEquals(seen[0].auth, null);
});

Deno.test("runPluginResponseTransforms: fails closed (auth stays null) when authz is not passed — no ROLE_PERMISSIONS fallback", async () => {
  const auth = makeAuth({
    result: { authenticated: true, user: makeUser("editor") },
  });
  const { plugin, seen } = makeRecordingPlugin();
  await runPluginResponseTransforms({
    req: makeReq("/about", SESSION_COOKIE),
    response: new Response("hello"),
    plugins: [plugin],
    auth,
    resolve,
    config,
    adminPrefix: "/admin",
  });
  assertEquals(seen[0].auth, null);
});

Deno.test("runPluginResponseTransforms: authz.check() denying scrubs markers", async () => {
  const auth = makeAuth({
    result: { authenticated: true, user: makeUser("editor") },
  });
  // deno-lint-ignore no-explicit-any
  const authz = makeAuthz(false) as any;
  const result = await runPluginResponseTransforms({
    req: makeReq("/about", SESSION_COOKIE),
    response: htmlResponse(MARKED_HTML),
    plugins: [],
    auth,
    authz,
    resolve,
    config,
    adminPrefix: "/admin",
  });
  assertEquals(await result.text(), `<h1>About</h1><div>body</div>`);
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
    resolve,
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
    resolve,
    config,
    adminPrefix: "/admin",
  });
  assertEquals(await result.text(), `<h1>About</h1><div>body</div>`);
  assertEquals(auth.calls.authenticate, 0);
});

Deno.test("marker scrub: forged/invalid session cookie still gets scrubbed", async () => {
  const auth = makeAuth({
    result: { authenticated: false, error: "bad session" },
  });
  const result = await runPluginResponseTransforms({
    req: makeReq("/about", "dune_session=forged"),
    response: htmlResponse(MARKED_HTML),
    plugins: [],
    auth,
    resolve,
    config,
    adminPrefix: "/admin",
  });
  assertEquals(auth.calls.authenticate, 1);
  assertEquals(await result.text(), `<h1>About</h1><div>body</div>`);
});

Deno.test("marker scrub: valid session WITHOUT pages.update gets scrubbed", async () => {
  const auth = makeAuth({
    result: { authenticated: true, user: makeUser("author") },
  });
  const result = await runPluginResponseTransforms({
    req: makeReq("/about", SESSION_COOKIE),
    response: htmlResponse(MARKED_HTML),
    plugins: [],
    auth,
    resolve,
    config,
    adminPrefix: "/admin",
  });
  assertEquals(await result.text(), `<h1>About</h1><div>body</div>`);
});

Deno.test("marker scrub: valid editing session keeps markers", async () => {
  const auth = makeAuth({
    result: { authenticated: true, user: makeUser("editor") },
  });
  // deno-lint-ignore no-explicit-any
  const authz = makeAuthz(true) as any;
  const result = await runPluginResponseTransforms({
    req: makeReq("/about", SESSION_COOKIE),
    response: htmlResponse(MARKED_HTML),
    plugins: [],
    auth,
    authz,
    resolve,
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
      return new Response(
        `${body}<span data-dune-field="x" data-dune-source="s.md">v</span>`,
        {
          status: ctx.response.status,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        },
      );
    },
  };
  const result = await runPluginResponseTransforms({
    req: makeReq("/about"),
    response: htmlResponse(`<p>p</p>`),
    plugins: [plugin],
    auth,
    resolve,
    config,
    adminPrefix: "/admin",
  });
  // Even markers introduced by a transform are stripped for anonymous visitors.
  assertEquals(await result.text(), `<p>p</p><span>v</span>`);
});

Deno.test("runPluginResponseTransforms: ctx.plugins lets a bar-owning plugin collect another plugin's adminBarActions", async () => {
  const auth = makeAuth({
    result: { authenticated: true, user: makeUser("admin") },
  });

  // A plugin that only contributes adminBarActions — no transformResponse
  // of its own. Confirms ctx.plugins is the full list, not just the ones
  // already filtered on transformResponse.
  const contributor: DunePlugin = {
    name: "pdf-export",
    version: "1.0.0",
    hooks: {},
    adminBarActions: ({ page }) =>
      page?.template === "post"
        ? [{ id: "pdf-export:download", label: "PDF", href: `/pdf/${page.sourcePath}` }]
        : [],
  };

  // The bar-owning plugin: renders whatever adminBarActions it can collect
  // from ctx.plugins into the response body, to prove it received them.
  const barOwner: DunePlugin = {
    name: "bar-owner",
    version: "1.0.0",
    hooks: {},
    async transformResponse(ctx) {
      const body = await ctx.response.text();
      const actions = ctx.plugins.flatMap((p) =>
        p.adminBarActions?.({ page: ctx.page, adminPrefix: ctx.adminPrefix }) ?? []
      );
      const rendered = actions.map((a) => `<a id="${a.id}" href="${a.href}">${a.label}</a>`).join("");
      return new Response(`${body}${rendered}`, {
        status: ctx.response.status,
        headers: ctx.response.headers,
      });
    },
  };

  const result = await runPluginResponseTransforms({
    req: makeReq("/about", SESSION_COOKIE),
    response: htmlResponse(`<p>p</p>`),
    plugins: [contributor, barOwner],
    auth,
    resolve,
    config,
    adminPrefix: "/admin",
  });

  assertEquals(
    await result.text(),
    `<p>p</p><a id="pdf-export:download" href="/pdf/content/about.md">PDF</a>`,
  );
});

Deno.test("runPluginResponseTransforms: page.template is populated from the content index", async () => {
  const { plugin, seen } = makeRecordingPlugin();
  const result = await runPluginResponseTransforms({
    req: makeReq("/about"),
    response: new Response("hello"),
    plugins: [plugin],
    auth: makeAuth({}),
    resolve,
    config,
    adminPrefix: "/admin",
  });
  await result.text();
  assertEquals(seen[0].page?.template, "post");
});

// ---------------------------------------------------------------------------
// Home-page routing: the resolve() callback must reflect the same home-page
// mapping the content pipeline uses ("/" -> whatever page the router treats
// as home), not just an exact route === pathname match — a prior hand-rolled
// matcher here missed this, so the admin bar (and every other transformResponse
// plugin) silently never received `page` for any site's homepage.
// ---------------------------------------------------------------------------

Deno.test("runPluginResponseTransforms: resolve() mapping '/' to the home page reaches plugins as `page`", async () => {
  const homeAwareResolve = (pathname: string) => {
    // Simulates what engine.router.resolve() actually does: "/" maps to the
    // configured/autodetected home page, whose own stored route is NOT "/".
    if (pathname === "/") {
      return {
        type: "page" as const,
        page: {
          route: "/home",
          sourcePath: "content/01.home/default.md",
          title: "Welcome",
          language: "en",
          template: "default",
        },
      };
    }
    return resolveFor(pages)(pathname);
  };

  const { plugin, seen } = makeRecordingPlugin();
  const result = await runPluginResponseTransforms({
    req: makeReq("/"),
    response: new Response("hello"),
    plugins: [plugin],
    auth: makeAuth({}),
    resolve: homeAwareResolve,
    config,
    adminPrefix: "/admin",
  });
  await result.text();
  assertEquals(seen[0].page?.sourcePath, "content/01.home/default.md");
});
