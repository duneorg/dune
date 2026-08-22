/**
 * Tests for account linking — GET /auth/{provider}/link,
 * GET /auth/{provider}/callback (link-flow branch), and
 * POST /auth/{provider}/unlink.
 *
 * Builds createAuthRoutes() against real (in-memory) userStore/sessions/
 * middleware — a mocked OAuthProvider is the only fake, so the actual
 * cookie round-trip (OAUTH_STATE_COOKIE / OAUTH_LINK_COOKIE) and session
 * creation are exercised for real, not just asserted on the type level.
 */

import { assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createAuthRoutes } from "../../src/auth/routes.ts";
import { createLocalUserStore } from "../../src/auth/user-store.ts";
import { createSiteAuthMiddleware, OAUTH_LINK_COOKIE, OAUTH_STATE_COOKIE } from "../../src/auth/middleware.ts";
import { createSessionManager, createSessionStore } from "../../src/session/mod.ts";
import type { OAuthProvider } from "../../src/auth/providers/types.ts";
import type { User } from "../../src/auth/types.ts";

// Minimal in-memory StorageAdapter, mirroring tests/auth/user_store_test.ts.
function createMemoryStorage() {
  const files = new Map<string, Uint8Array>();
  return {
    async read(path: string) {
      const d = files.get(path);
      if (!d) throw new Error(`Not found: ${path}`);
      return d;
    },
    async readText(path: string) {
      const d = files.get(path);
      if (!d) throw new Error(`Not found: ${path}`);
      return new TextDecoder().decode(d);
    },
    async write(path: string, data: Uint8Array | string) {
      files.set(path, typeof data === "string" ? new TextEncoder().encode(data) : data);
    },
    async exists(path: string) {
      return files.has(path);
    },
    async delete(path: string) {
      files.delete(path);
    },
    async list(dir: string) {
      const prefix = dir.endsWith("/") ? dir : dir + "/";
      const seen = new Set<string>();
      const result: { name: string; path: string; isFile: boolean; isDirectory: boolean }[] = [];
      for (const key of files.keys()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        if (!rest) continue;
        const segment = rest.split("/")[0];
        if (seen.has(segment)) continue;
        seen.add(segment);
        result.push({ name: segment, path: prefix + segment, isFile: !rest.includes("/"), isDirectory: rest.includes("/") });
      }
      return result;
    },
    async rename() {},
    async listRecursive() {
      return [];
    },
    async stat() {
      return { size: 0, mtime: 0, isFile: true, isDirectory: false };
    },
    async getJSON() {
      return null;
    },
    async setJSON() {},
    async deleteJSON() {},
    // deno-lint-ignore no-explicit-any
  } as any;
}

function makeMockProvider(
  profile: { id: string; email: string; name?: string; avatarUrl?: string },
): OAuthProvider {
  return {
    name: "github",
    authorizationUrl: (state, redirectUri) =>
      `https://provider.example/auth?state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`,
    exchangeCode: (_code, _redirectUri) => Promise.resolve({ accessToken: "tok" }),
    getUser: (_accessToken) => Promise.resolve(profile),
  };
}

function extractCookie(setCookieHeader: string | null, name: string): string | null {
  if (!setCookieHeader) return null;
  // Cookies are joined with ", " (see routes.ts) — split back into individual
  // Set-Cookie directives before looking for `name`.
  for (const part of setCookieHeader.split(/, (?=[^;]+=[^;]+; Path=)/)) {
    const match = part.match(new RegExp(`^${name}=([^;]*)`));
    if (match) return match[1];
  }
  return null;
}

async function buildHarness(opts: {
  profile?: { id: string; email: string; name?: string; avatarUrl?: string };
  magicLinkEnabled?: boolean;
  userStoreType?: "local" | "session" | "db";
}) {
  const storage = createMemoryStorage();
  const userStore = createLocalUserStore({ storage, usersDir: "data/users" });
  const sessionStore = await createSessionStore({
    type: "local",
    storage,
    sessionsDir: "data/sessions",
    lifetimeMs: 60 * 60 * 1000,
  });
  const sessions = createSessionManager(sessionStore, 60 * 60 * 1000);
  const middleware = createSiteAuthMiddleware({ userStore, sessions, secure: false });

  const provider = makeMockProvider(opts.profile ?? { id: "gh-1", email: "linked@example.com" });
  const providers = new Map([["github", provider]]);

  const routes = createAuthRoutes({
    userStore,
    middleware,
    providers,
    magicLinkEnabled: opts.magicLinkEnabled ?? true,
    magicLinkSecret: "test-secret",
    siteUrl: "https://example.com",
    mode: "dune",
    userStoreType: opts.userStoreType ?? "local",
  });

  return { routes, userStore, middleware, sessions };
}

async function loginAs(
  middleware: ReturnType<typeof createSiteAuthMiddleware>,
  userId: string,
): Promise<{ user: User | null; cookieValue: string }> {
  const sessionId = await middleware.createSession(userId);
  const cookieHeader = middleware.createSessionCookie(sessionId);
  const cookieValue = cookieHeader.split(";")[0].split("=").slice(1).join("=");
  const req = new Request("https://example.com/", {
    headers: { Cookie: `dune_auth=${cookieValue}` },
  });
  const user = await middleware.resolveUser(req);
  return { user, cookieValue };
}

// ── oauthLinkStart ───────────────────────────────────────────────────────

Deno.test("oauthLinkStart: 401 when not logged in", async () => {
  const { routes } = await buildHarness({});
  const res = routes.oauthLinkStart(new Request("https://example.com/auth/github/link"), "github", null);
  assertEquals(res.status, 401);
});

Deno.test("oauthLinkStart: 404 for an unknown provider", async () => {
  const { routes, userStore } = await buildHarness({});
  const user = await userStore.create({ email: "a@example.com", provider: "magic", roles: [] });
  const res = routes.oauthLinkStart(new Request("https://example.com/auth/google/link"), "google", user);
  assertEquals(res.status, 404);
});

Deno.test("oauthLinkStart: 400 when userStoreType is 'session'", async () => {
  const { routes, userStore } = await buildHarness({ userStoreType: "session" });
  const user = await userStore.create({ email: "a@example.com", provider: "magic", roles: [] });
  const res = routes.oauthLinkStart(new Request("https://example.com/auth/github/link"), "github", user);
  assertEquals(res.status, 400);
});

Deno.test("oauthLinkStart: sets both the state and link cookies, redirects to the provider", async () => {
  const { routes, userStore } = await buildHarness({});
  const user = await userStore.create({ email: "a@example.com", provider: "magic", roles: [] });
  const res = routes.oauthLinkStart(new Request("https://example.com/auth/github/link"), "github", user);
  assertEquals(res.status, 302);
  assertMatch(res.headers.get("Location") ?? "", /^https:\/\/provider\.example\/auth\?state=/);
  const setCookie = res.headers.get("Set-Cookie");
  assertEquals(extractCookie(setCookie, OAUTH_LINK_COOKIE), user.id);
  assertEquals(typeof extractCookie(setCookie, OAUTH_STATE_COOKIE), "string");
});

// ── oauthCallback (link-flow branch) ─────────────────────────────────────

Deno.test("oauthCallback (link): links a brand-new provider identity to the current session's account", async () => {
  const { routes, userStore } = await buildHarness({ profile: { id: "gh-new", email: "x@example.com" } });
  const user = await userStore.create({ email: "a@example.com", provider: "magic", roles: [] });

  const start = routes.oauthLinkStart(new Request("https://example.com/auth/github/link"), "github", user);
  const state = new URL(start.headers.get("Location")!).searchParams.get("state")!;
  const stateCookie = extractCookie(start.headers.get("Set-Cookie"), OAUTH_STATE_COOKIE);
  const linkCookie = extractCookie(start.headers.get("Set-Cookie"), OAUTH_LINK_COOKIE);

  const callbackReq = new Request(
    `https://example.com/auth/github/callback?code=abc&state=${state}`,
    { headers: { Cookie: `${OAUTH_STATE_COOKIE}=${stateCookie}; ${OAUTH_LINK_COOKIE}=${linkCookie}` } },
  );
  const res = await routes.oauthCallback(callbackReq, "github", user);

  assertEquals(res.status, 302);
  assertEquals(res.headers.get("Location"), "/?dune_link=linked");

  const updated = await userStore.getById(user.id);
  assertEquals(updated?.linkedProviders, [{ provider: "github", providerId: "gh-new" }]);
});

Deno.test("oauthCallback (link): 403 when the active session doesn't match who started the flow", async () => {
  const { routes, userStore } = await buildHarness({ profile: { id: "gh-new", email: "x@example.com" } });
  const user = await userStore.create({ email: "a@example.com", provider: "magic", roles: [] });
  const otherUser = await userStore.create({ email: "b@example.com", provider: "magic", roles: [] });

  const start = routes.oauthLinkStart(new Request("https://example.com/auth/github/link"), "github", user);
  const state = new URL(start.headers.get("Location")!).searchParams.get("state")!;
  const stateCookie = extractCookie(start.headers.get("Set-Cookie"), OAUTH_STATE_COOKIE);
  const linkCookie = extractCookie(start.headers.get("Set-Cookie"), OAUTH_LINK_COOKIE);

  const callbackReq = new Request(
    `https://example.com/auth/github/callback?code=abc&state=${state}`,
    { headers: { Cookie: `${OAUTH_STATE_COOKIE}=${stateCookie}; ${OAUTH_LINK_COOKIE}=${linkCookie}` } },
  );
  // Active session is now otherUser, not the user who started the link flow.
  const res = await routes.oauthCallback(callbackReq, "github", otherUser);

  assertEquals(res.status, 403);
  const unchanged = await userStore.getById(user.id);
  assertEquals(unchanged?.linkedProviders ?? [], []);
});

Deno.test("oauthCallback (link): already linked to this same account is a no-op success", async () => {
  const { routes, userStore } = await buildHarness({ profile: { id: "gh-1", email: "x@example.com" } });
  let user = await userStore.create({ email: "a@example.com", provider: "magic", roles: [] });
  user = (await userStore.linkProvider(user.id, "github", "gh-1"))!;

  const start = routes.oauthLinkStart(new Request("https://example.com/auth/github/link"), "github", user);
  const state = new URL(start.headers.get("Location")!).searchParams.get("state")!;
  const stateCookie = extractCookie(start.headers.get("Set-Cookie"), OAUTH_STATE_COOKIE);
  const linkCookie = extractCookie(start.headers.get("Set-Cookie"), OAUTH_LINK_COOKIE);

  const callbackReq = new Request(
    `https://example.com/auth/github/callback?code=abc&state=${state}`,
    { headers: { Cookie: `${OAUTH_STATE_COOKIE}=${stateCookie}; ${OAUTH_LINK_COOKIE}=${linkCookie}` } },
  );
  const res = await routes.oauthCallback(callbackReq, "github", user);

  assertEquals(res.status, 302);
  assertEquals(res.headers.get("Location"), "/?dune_link=already_linked");
});

Deno.test("oauthCallback (link): exact-match-wins — provider identity already belongs to a different account logs into THAT account", async () => {
  const { routes, userStore, middleware } = await buildHarness({
    profile: { id: "gh-owned", email: "owner@example.com" },
  });
  const owner = await userStore.create({ email: "owner@example.com", provider: "github", providerId: "gh-owned", roles: [] });
  const linkingUser = await userStore.create({ email: "linker@example.com", provider: "magic", roles: [] });

  const start = routes.oauthLinkStart(new Request("https://example.com/auth/github/link"), "github", linkingUser);
  const state = new URL(start.headers.get("Location")!).searchParams.get("state")!;
  const stateCookie = extractCookie(start.headers.get("Set-Cookie"), OAUTH_STATE_COOKIE);
  const linkCookie = extractCookie(start.headers.get("Set-Cookie"), OAUTH_LINK_COOKIE);

  const callbackReq = new Request(
    `https://example.com/auth/github/callback?code=abc&state=${state}`,
    { headers: { Cookie: `${OAUTH_STATE_COOKIE}=${stateCookie}; ${OAUTH_LINK_COOKIE}=${linkCookie}` } },
  );
  const res = await routes.oauthCallback(callbackReq, "github", linkingUser);

  assertEquals(res.status, 302);
  assertEquals(res.headers.get("Location"), "/?dune_link=linked_elsewhere");

  // The new session cookie in the response resolves to the OWNER, not linkingUser.
  const newSessionValue = extractCookie(res.headers.get("Set-Cookie"), "dune_auth");
  const resolveReq = new Request("https://example.com/", {
    headers: { Cookie: `dune_auth=${newSessionValue}` },
  });
  const resolved = await middleware.resolveUser(resolveReq);
  assertEquals(resolved?.id, owner.id);

  // linkingUser was never mutated.
  const unchangedLinker = await userStore.getById(linkingUser.id);
  assertEquals(unchangedLinker?.linkedProviders ?? [], []);
});

Deno.test("oauthCallback: an ordinary login (no link cookie) is unaffected by the linking feature", async () => {
  const { routes, userStore } = await buildHarness({ profile: { id: "gh-fresh", email: "fresh@example.com" } });

  const start = routes.oauthStart(new Request("https://example.com/auth/github"), "github");
  const state = new URL(start.headers.get("Location")!).searchParams.get("state")!;
  const stateCookie = extractCookie(start.headers.get("Set-Cookie"), OAUTH_STATE_COOKIE);

  const callbackReq = new Request(
    `https://example.com/auth/github/callback?code=abc&state=${state}`,
    { headers: { Cookie: `${OAUTH_STATE_COOKIE}=${stateCookie}` } },
  );
  const res = await routes.oauthCallback(callbackReq, "github", null);

  assertEquals(res.status, 302);
  assertEquals(res.headers.get("Location"), "/");
  const created = await userStore.getByProvider("github", "gh-fresh");
  assertEquals(created?.email, "fresh@example.com");
});

// ── unlinkProvider ───────────────────────────────────────────────────────

Deno.test("unlinkProvider: 401 when not logged in", async () => {
  const { routes } = await buildHarness({});
  const res = await routes.unlinkProvider(
    new Request("https://example.com/auth/github/unlink", { method: "POST" }),
    "github",
    null,
  );
  assertEquals(res.status, 401);
});

Deno.test("unlinkProvider: rejects a cross-origin request", async () => {
  const { routes, userStore } = await buildHarness({});
  const user = await userStore.create({ email: "a@example.com", provider: "magic", roles: [] });
  const res = await routes.unlinkProvider(
    new Request("https://example.com/auth/github/unlink", {
      method: "POST",
      headers: { Origin: "https://evil.example" },
    }),
    "github",
    user,
  );
  assertEquals(res.status, 403);
});

Deno.test("unlinkProvider: 400 when the provider isn't linked", async () => {
  const { routes, userStore } = await buildHarness({});
  const user = await userStore.create({ email: "a@example.com", provider: "magic", roles: [] });
  const res = await routes.unlinkProvider(
    new Request("https://example.com/auth/github/unlink", { method: "POST" }),
    "github",
    user,
  );
  assertEquals(res.status, 400);
});

Deno.test("unlinkProvider: 400 when trying to unlink the primary (original signup) provider", async () => {
  const { routes, userStore } = await buildHarness({});
  const user = await userStore.create({ email: "a@example.com", provider: "github", providerId: "gh-1", roles: [] });
  const res = await routes.unlinkProvider(
    new Request("https://example.com/auth/github/unlink", { method: "POST" }),
    "github",
    user,
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertMatch(body.error, /original signup provider/);
});

Deno.test("unlinkProvider: removes a linked entry when magic link is enabled", async () => {
  const { routes, userStore } = await buildHarness({ magicLinkEnabled: true });
  let user = await userStore.create({ email: "a@example.com", provider: "magic", roles: [] });
  user = (await userStore.linkProvider(user.id, "github", "gh-1"))!;

  const res = await routes.unlinkProvider(
    new Request("https://example.com/auth/github/unlink", { method: "POST" }),
    "github",
    user,
  );
  assertEquals(res.status, 200);
  const updated = await userStore.getById(user.id);
  assertEquals(updated?.linkedProviders ?? [], []);
});

Deno.test("unlinkProvider: blocks removing the last linked entry when magic link is disabled", async () => {
  const { routes, userStore } = await buildHarness({ magicLinkEnabled: false });
  let user = await userStore.create({ email: "a@example.com", provider: "github", providerId: "gh-primary", roles: [] });
  user = (await userStore.linkProvider(user.id, "google", "gg-1"))!;

  const res = await routes.unlinkProvider(
    new Request("https://example.com/google/unlink", { method: "POST" }),
    "google",
    user,
  );
  assertEquals(res.status, 400);
  const unchanged = await userStore.getById(user.id);
  assertEquals(unchanged?.linkedProviders, [{ provider: "google", providerId: "gg-1" }]);
});

Deno.test("unlinkProvider: allows removing one of several linked entries even when magic link is disabled", async () => {
  const { routes, userStore } = await buildHarness({ magicLinkEnabled: false });
  let user = await userStore.create({ email: "a@example.com", provider: "github", providerId: "gh-primary", roles: [] });
  user = (await userStore.linkProvider(user.id, "google", "gg-1"))!;
  user = (await userStore.linkProvider(user.id, "discord", "dc-1"))!;

  const res = await routes.unlinkProvider(
    new Request("https://example.com/auth/google/unlink", { method: "POST" }),
    "google",
    user,
  );
  assertEquals(res.status, 200);
  const updated = await userStore.getById(user.id);
  assertEquals(updated?.linkedProviders, [{ provider: "discord", providerId: "dc-1" }]);
});
