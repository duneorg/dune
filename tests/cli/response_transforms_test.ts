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
import {
  type RunResponseTransformsOptions,
  runPluginResponseTransforms as run,
} from "../../src/cli/response-transforms.ts";
import { createEditorResolver } from "../../src/auth/editor.ts";
import { DUNE_BASE_AUTHZ_ACTIONS } from "../../src/auth/authz-schema.ts";
import type { DuneAuthSystem } from "../../src/auth/authz.ts";
import type {
  DunePlugin,
  ResponseTransformContext,
} from "../../src/hooks/types.ts";
import type { DuneConfig } from "../../src/config/types.ts";
import type { User } from "../../src/auth/types.ts";

/** What the fake auth middleware resolves to (the admin's result shape, kept local: core tests do not depend on the published admin). */
interface AuthResult {
  authenticated: boolean;
  user?: User;
  error?: string;
}

const config = {} as DuneConfig;

/**
 * Drive the pipeline the way core does: the options a test names (a session
 * provider, its cookie names, an authz system) become the editor resolver the
 * pipeline is given. Tests keep stating the scenario, not the wiring.
 */
type LegacyOptions =
  & Omit<RunResponseTransformsOptions, "resolveEditor">
  & {
    auth?: { authenticate(req: Request): Promise<unknown> } | null;
    sessionCookies?: readonly string[];
    authz?: DuneAuthSystem;
  };
function runPluginResponseTransforms(opts: LegacyOptions): Promise<Response> {
  const { auth, sessionCookies, authz, ...rest } = opts;
  const provider = auth ? Object.assign(auth, { sessionCookies }) : undefined;
  const capabilities = rest.capabilities ?? {
    get: (name: string) => (name === "editor.session" ? provider : undefined),
    list: () => [],
    providers: () => [],
    // deno-lint-ignore no-explicit-any
  } as any;
  const resolveEditor = createEditorResolver({
    capabilities: {
      ...capabilities,
      get: (name: string) => name === "editor.session" ? provider : capabilities.get(name),
    },
    siteAuthz: () => authz,
    sessionAuthz: () => authz,
  });
  return run({ ...rest, capabilities, resolveEditor });
}

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
  const authz = makeAuthz(true, "editor") as any;
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
  // "editor" grants pages.update but not the admin-only users.update.
  assertEquals(ctxAuth?.hasPermission("pages.update"), true);
  assertEquals(ctxAuth?.hasPermission("pages.delete"), false);
});

Deno.test("runPluginResponseTransforms: roles[] mixing tags and admin roles — the relation authz reports is the role", async () => {
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
  assertEquals(ctxAuth?.hasPermission("users.update"), true);
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

/** An authz system whose user holds `relation` (when `allowed`), answering each action as the built-in schema does. */
function makeAuthz(allowed: boolean, relation: "admin" | "editor" | "author" = "admin") {
  const calls = { check: 0 };
  return {
    calls,
    // deno-lint-ignore no-explicit-any
    check(args: any): Promise<boolean> {
      calls.check++;
      const relations: readonly string[] = (DUNE_BASE_AUTHZ_ACTIONS as Record<string, readonly string[]>)[args.canThey] ?? [];
      return Promise.resolve(allowed && relations.includes(relation));
    },
  };
}

Deno.test("runPluginResponseTransforms: authz.check() allowing grants access", async () => {
  const auth = makeAuth({
    result: { authenticated: true, user: makeUser("author") },
  });
  // deno-lint-ignore no-explicit-any
  const authz = makeAuthz(true, "author") as any;
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
  // pages.update, then the probes that tell author from editor and admin.
  assertEquals(authz.calls.check > 0, true);
  assertEquals(seen[0].auth?.username, "alice");
  assertEquals(seen[0].auth?.role, "author");
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

Deno.test("runPluginResponseTransforms: a provider that declares its cookie name is consulted for that cookie only", async () => {
  const mk = () => makeAuth({ result: { authenticated: true, user: makeUser("admin") } });
  const run = (auth: ReturnType<typeof mk>, cookie: string | undefined) =>
    runPluginResponseTransforms({
      req: makeReq("/about", cookie),
      response: htmlResponse(`<p>p</p>`),
      plugins: [],
      auth,
      sessionCookies: ["stub_sid"],
      resolve,
      config,
      adminPrefix: "/admin",
    });

  const own = mk();
  await run(own, "stub_sid=abc123");
  assertEquals(own.calls.authenticate, 1, "its own cookie triggers the lookup");

  const dune = mk();
  await run(dune, "dune_session=abc123");
  assertEquals(dune.calls.authenticate, 0, "another admin's cookie name does not");
});

Deno.test("runPluginResponseTransforms: without declared cookie names any cookie triggers the lookup", async () => {
  const withCookie = makeAuth({ result: { authenticated: true, user: makeUser("admin") } });
  await runPluginResponseTransforms({
    req: makeReq("/about", "whatever=1"),
    response: htmlResponse(`<p>p</p>`),
    plugins: [],
    auth: withCookie,
    resolve,
    config,
    adminPrefix: "/admin",
  });
  assertEquals(withCookie.calls.authenticate, 1);

  const noCookie = makeAuth({ result: { authenticated: true, user: makeUser("admin") } });
  await runPluginResponseTransforms({
    req: makeReq("/about"),
    response: htmlResponse(`<p>p</p>`),
    plugins: [],
    auth: noCookie,
    resolve,
    config,
    adminPrefix: "/admin",
  });
  assertEquals(noCookie.calls.authenticate, 0);
});

Deno.test("runPluginResponseTransforms: no admin prefix — /admin is an ordinary path and plugins get an empty adminPrefix", async () => {
  const auth = makeAuth({});
  const { plugin, seen } = makeRecordingPlugin();
  const result = await runPluginResponseTransforms({
    req: makeReq("/admin/news"),
    response: htmlResponse("<p>news</p>"),
    plugins: [plugin],
    auth,
    resolve,
    config,
    adminPrefix: null,
  });
  assertEquals(seen.length, 1, "the transform ran: with no admin, /admin/news is content");
  assertEquals((await result.text()).includes("news"), true);
});

Deno.test("runPluginResponseTransforms: an admin prefix still keeps its own paths out of the pipeline", async () => {
  const { plugin, seen } = makeRecordingPlugin();
  const original = htmlResponse("<p>panel</p>");
  const result = await runPluginResponseTransforms({
    req: makeReq("/admin/pages"),
    response: original,
    plugins: [plugin],
    auth: makeAuth({}),
    resolve,
    config,
    adminPrefix: "/admin",
  });
  assertEquals(seen.length, 0);
  assertStrictEquals(result, original);
});

Deno.test("runPluginResponseTransforms: ctx.capabilities is the registry's reader, and empty when none is supplied", async () => {
  const { plugin, seen } = makeRecordingPlugin();
  await runPluginResponseTransforms({
    req: makeReq("/about"),
    response: htmlResponse(`<p>p</p>`),
    plugins: [plugin],
    auth: null,
    resolve,
    config,
    adminPrefix: "/admin",
  });
  assertEquals(seen[0].capabilities.get("admin.prefix"), undefined);
  assertEquals(seen[0].capabilities.providers(), []);

  const reader = {
    get: (name: string) => (name === "admin.prefix" ? { prefix: "/admin" } : undefined),
    list: () => [],
    providers: () => [],
    // deno-lint-ignore no-explicit-any
  } as any;
  await runPluginResponseTransforms({
    req: makeReq("/about"),
    response: htmlResponse(`<p>p</p>`),
    plugins: [plugin],
    auth: null,
    resolve,
    config,
    adminPrefix: "/admin",
    capabilities: reader,
  });
  assertEquals(seen[1].capabilities.get("admin.prefix")?.prefix, "/admin");
});
