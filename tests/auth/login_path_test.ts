/**
 * `site.auth.login_path` (#159): a site serving its own login page.
 */
import { assertEquals, assertStrictEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  DEFAULT_LOGIN_PATH,
  enforceRoles,
  isValidLoginPath,
  loginPathForRequest,
  normalizeRoutePath,
  mediaDenialResponse,
  resolveLoginPath,
  setGatingLoginPath,
} from "../../src/auth/gating.ts";
import { applyGatingInheritance } from "../../src/content/index-builder.ts";
import { validateConfig } from "../../src/config/validator.ts";
import { DEFAULT_CONFIG } from "../../src/config/defaults.ts";
import { createAuthRoutes } from "../../src/auth/routes.ts";
import { createLocalUserStore } from "../../src/auth/user-store.ts";
import { createSiteAuthMiddleware } from "../../src/auth/middleware.ts";
import { createSessionManager, createSessionStore } from "../../src/session/mod.ts";
import { LocalRateLimitStore } from "../../src/security/rate-limit-store.ts";
import type { PageIndex } from "../../src/content/types.ts";

Deno.test("isValidLoginPath: local absolute paths only", () => {
  for (const ok of ["/join", "/auth/login", "/members/sign-in", "/a_b.c~d", "/"]) {
    assertStrictEquals(isValidLoginPath(ok), true, ok);
  }
  for (
    const bad of [
      "", "join", "//evil.com", "//evil.com/x", "https://evil.com", "/join?x=1", "/join#x", "/a/../b",
      "/..", "/a b", "/a\\b", "/a\nb", 5, null, undefined,
    ]
  ) {
    assertStrictEquals(isValidLoginPath(bad), false, String(bad));
  }
  assertEquals(resolveLoginPath("//evil.com"), DEFAULT_LOGIN_PATH);
  assertEquals(resolveLoginPath(undefined), DEFAULT_LOGIN_PATH);
  assertEquals(resolveLoginPath("/join"), "/join");
});

Deno.test("validateConfig: rejects a bad site.auth.login_path", () => {
  const config = structuredClone(DEFAULT_CONFIG);
  config.site.auth = { login_path: "//evil.com" };
  assertEquals(validateConfig(config).some((e) => e.includes("site.auth.login_path")), true);
  config.site.auth = { login_path: "/join" };
  assertEquals(validateConfig(config).length, 0);
});

Deno.test("gating redirects go to the configured login path, with next", async () => {
  const origin = "https://members.example";
  setGatingLoginPath("/join", origin);
  try {
    const req = new Request(`${origin}/secret/page?x=1`);
    assertEquals(loginPathForRequest(req), "/join");
    const denied = (await enforceRoles(req, null, []))!;
    assertEquals(denied.status, 302);
    assertEquals(denied.headers.get("location"), "/join?next=%2Fsecret%2Fpage%3Fx%3D1");

    // A logged-out document navigation to gated media is sent to the same page.
    const media = new Request(`${origin}/content-media/05.a/doc.pdf`, {
      headers: { "sec-fetch-dest": "document" },
    });
    const mediaDenied = (await enforceRoles(media, null, []))!;
    assertEquals(
      mediaDenialResponse(media, mediaDenied).headers.get("location"),
      "/join?next=%2Fcontent-media%2F05.a%2Fdoc.pdf",
    );
  } finally {
    setGatingLoginPath(null, origin);
  }
  // Unset: back to the default.
  const plain = new Request("https://other.example/x");
  assertEquals(loginPathForRequest(plain), DEFAULT_LOGIN_PATH);
  assertEquals(
    (await enforceRoles(plain, null, []))!.headers.get("location"),
    "/auth/login?next=%2Fx",
  );
});

function page(route: string, sourcePath: string, ownRoles?: unknown): PageIndex {
  return {
    route,
    sourcePath,
    language: "en",
    parentPath: null,
    ownRoles,
    roles: ownRoles,
    gated: ownRoles !== undefined,
  } as unknown as PageIndex;
}

Deno.test("applyGatingInheritance: the login_path page is exempt from the site default", () => {
  const login = page("/join", "01.join/default.md");
  const other = page("/about", "02.about/default.md");
  applyGatingInheritance([login, other], "any", "/join");
  assertEquals(login.gated, false);
  assertEquals(other.gated, true);

  // Without login_path, the same page is gated by the default (the loop this prevents)
  const unexempt = page("/join", "01.join/default.md");
  applyGatingInheritance([unexempt], "any");
  assertEquals(unexempt.gated, true);

  // Its own roles: still applies.
  const own = page("/join", "01.join/default.md", "member");
  applyGatingInheritance([own], "any", "/join");
  assertEquals(own.gated, true);
});

async function harness(loginPath?: string) {
  const files = new Map<string, Uint8Array>();
  // deno-lint-ignore no-explicit-any
  const storage: any = {
    read: async (p: string) => {
      const d = files.get(p);
      if (!d) throw new Error("nf");
      return d;
    },
    readText: async (p: string) => new TextDecoder().decode(files.get(p)!),
    write: async (p: string, d: Uint8Array | string) => {
      files.set(p, typeof d === "string" ? new TextEncoder().encode(d) : d);
    },
    exists: async (p: string) => files.has(p),
    delete: async (p: string) => {
      files.delete(p);
    },
    list: async () => [],
    rename: async () => {},
    listRecursive: async () => [],
    stat: async () => ({ size: 0, mtime: 0, isFile: true, isDirectory: false }),
    getJSON: async () => null,
    setJSON: async () => {},
    deleteJSON: async () => {},
  };
  const userStore = createLocalUserStore({ storage, usersDir: "data/users" });
  const sessionStore = await createSessionStore({
    type: "local",
    storage,
    sessionsDir: "data/sessions",
    lifetimeMs: 3600_000,
  });
  const sessions = createSessionManager(sessionStore, 3600_000);
  const middleware = createSiteAuthMiddleware({ userStore, sessions, secure: false });
  return createAuthRoutes({
    userStore,
    middleware,
    providers: new Map(),
    magicLinkEnabled: true,
    magicLinkSecret: "test-secret",
    siteUrl: "https://example.com",
    mode: "dune",
    passwordLoginEnabled: true,
    rateLimitStore: new LocalRateLimitStore(),
    loginPath,
  });
}

Deno.test("GET /auth/login redirects to login_path, keeping the query", async () => {
  const routes = await harness("/join");
  const res = await routes.login(new Request("https://example.com/auth/login?next=%2Fa&error=invalid"), null);
  assertEquals(res.status, 302);
  assertEquals(res.headers.get("location"), "/join?next=%2Fa&error=invalid");
});

Deno.test("GET /auth/login still renders when login_path is unset or is /auth/login (no loop)", async () => {
  for (const lp of [undefined, "/auth/login"]) {
    const routes = await harness(lp);
    const res = await routes.login(new Request("https://example.com/auth/login"), null);
    assertEquals(res.status, 200, String(lp));
  }
});

Deno.test("a failed password login goes back to login_path", async () => {
  const routes = await harness("/join");
  const form = new URLSearchParams({ identifier: "nobody", password: "wrong", next: "/members" });
  const res = await routes.passwordLogin(
    new Request("https://example.com/auth/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://example.com" },
      body: form,
    }),
  );
  assertEquals(res.status, 303);
  assertEquals(res.headers.get("location"), "/join?error=invalid&next=%2Fmembers");
});

Deno.test("a bad magic link's Try again points at login_path", async () => {
  const routes = await harness("/join");
  const res = await routes.magicVerify(new Request("https://example.com/auth/magic/verify"));
  const html = await res.text();
  assertEquals(html.includes('href="/join"'), true);
});

Deno.test("multisite: a site without login_path never gets another site's path", async () => {
  const a = "https://a.example";
  const b = "https://b.example";
  // mountDuneAuth registers every site, the default included.
  setGatingLoginPath("/join", a);
  setGatingLoginPath(DEFAULT_LOGIN_PATH, b);
  try {
    assertEquals(loginPathForRequest(new Request(`${a}/x`)), "/join");
    assertEquals(loginPathForRequest(new Request(`${b}/x`)), "/auth/login");
    assertEquals(
      (await enforceRoles(new Request(`${b}/x`), null, []))!.headers.get("location"),
      "/auth/login?next=%2Fx",
    );
  } finally {
    setGatingLoginPath(null, a);
    setGatingLoginPath(null, b);
  }
});

Deno.test("a trailing slash on login_path is normalized for redirects and the exemption", () => {
  assertEquals(resolveLoginPath("/join/"), "/join");
  assertEquals(resolveLoginPath("/"), "/");
  assertEquals(normalizeRoutePath("/a/b//"), "/a/b");

  const login = page("/join", "01.join/default.md");
  const other = page("/about", "02.about/default.md");
  applyGatingInheritance([login, other], "any", "/join/");
  assertEquals(login.gated, false);
  assertEquals(other.gated, true);
});

Deno.test("the login page's translations are exempt too", () => {
  const en = page("/join", "01.join/default.md");
  const de = page("/de/join", "01.join/default.de.md");
  de.language = "de";
  const sibling = page("/join/faq", "01.join/02.faq/default.md");
  const other = page("/about", "02.about/default.md");
  applyGatingInheritance([en, de, sibling, other], "any", "/join");
  assertEquals(en.gated, false);
  assertEquals(de.gated, false);
  // A child page of the login page is an ordinary page: default_roles applies.
  assertEquals(sibling.gated, true);
  assertEquals(other.gated, true);
});
