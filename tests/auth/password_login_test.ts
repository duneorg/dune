/**
 * `POST /auth/login`: password login for `provider: "local"` accounts on a
 * site with the admin switched off. Real bootstrap, real routes, real user
 * store; only the clock and the network are not involved.
 */

import { assert, assertEquals, assertNotEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { App } from "fresh";
import { bootstrap } from "../../src/runtime/bootstrap.ts";
import { mountDuneAuth } from "../../src/auth/mount.ts";
import { createLocalUserStore } from "../../src/auth/user-store.ts";
import { createStorage } from "../../src/storage/mod.ts";
import { DUMMY_HASH, hashPassword, needsRehash } from "../../src/auth/passwords.ts";
import { rememberSocketAddr } from "../../src/security/rate-limit.ts";
import { sanitizeNext } from "../../src/auth/redirect.ts";
import {
  PASSWORD_LOGIN_IP_LIMIT,
  PASSWORD_LOGIN_LOCKOUT_THRESHOLD,
} from "../../src/auth/password-login.ts";

const PASSWORD = "correct horse battery staple";
const ORIGIN = "http://localhost:3000";

interface Site {
  /** Send a request through the mounted app. `ip` stamps the peer address. */
  call(path: string, init?: RequestInit & { ip?: string }): Promise<Response>;
  users: ReturnType<typeof createLocalUserStore>;
  root: string;
}

async function withSite(
  opts: { password?: boolean; userStore?: string; theme?: Record<string, string> },
  fn: (site: Site) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "dune_test_pw_login_" });
  try {
    await Deno.mkdir(join(root, "content", "01.home"), { recursive: true });
    await Deno.writeTextFile(join(root, "content", "01.home", "default.md"), "---\ntitle: Home\n---\n\nHello\n");
    await Deno.mkdir(join(root, "config"), { recursive: true });
    const themeName = opts.theme ? "t" : undefined;
    await Deno.writeTextFile(
      join(root, "config", "site.yaml"),
      `title: Test Site\nurl: ${ORIGIN}\n` +
        (themeName ? `theme:\n  name: ${themeName}\n` : "") +
        `auth:\n  mode: dune\n  user_store: ${opts.userStore ?? "local"}\n` +
        (opts.password === false ? "" : "  providers:\n    password:\n      enabled: true\n"),
    );
    await Deno.writeTextFile(join(root, "config", "system.yaml"), "admin:\n  enabled: false\n");
    for (const [path, body] of Object.entries(opts.theme ?? {})) {
      await Deno.mkdir(join(root, "themes", "t", path, ".."), { recursive: true });
      await Deno.writeTextFile(join(root, "themes", "t", path), body);
    }

    const users = createLocalUserStore({ storage: createStorage({ rootDir: root }), usersDir: "data/users" });
    const ctx = await bootstrap(root, {});
    // deno-lint-ignore no-explicit-any
    const app = new App() as any;
    await mountDuneAuth(app, ctx);
    const handler = app.handler();
    await fn({
      users,
      root,
      call: (path, init = {}) => {
        const { ip, ...rest } = init;
        const req = new Request(new URL(path, ORIGIN), rest);
        if (ip) rememberSocketAddr(req, { hostname: ip, port: 1, transport: "tcp" });
        return handler(req);
      },
    });
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
}

const SITE_OPTS = { sanitizeOps: false, sanitizeResources: false };

async function addUser(
  site: Site,
  over: Partial<Parameters<Site["users"]["create"]>[0]> = {},
) {
  return await site.users.create({
    email: "ed@example.test",
    username: "ed",
    name: "Ed",
    provider: "local",
    passwordHash: await hashPassword(PASSWORD),
    roles: ["member"],
    ...over,
  });
}

const form = (fields: Record<string, string>): RequestInit => ({
  method: "POST",
  headers: { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(fields).toString(),
});
const jsonBody = (fields: Record<string, string>): RequestInit => ({
  method: "POST",
  headers: { origin: ORIGIN, "content-type": "application/json" },
  body: JSON.stringify(fields),
});
const cookieOf = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0];

Deno.test("password login is off unless the site enables it", SITE_OPTS, async () => {
  await withSite({ password: false }, async (site) => {
    await addUser(site);
    const res = await site.call("/auth/login", form({ identifier: "ed", password: PASSWORD }));
    assertEquals(res.status, 404);
    const page = await (await site.call("/auth/login")).text();
    assert(!page.includes('name="password"'), "no password field when disabled");
  });
});

Deno.test("the login page offers the form when enabled, and carries a sanitised next", SITE_OPTS, async () => {
  await withSite({}, async (site) => {
    const page = await (await site.call("/auth/login?next=/account&error=invalid")).text();
    assertStringIncludes(page, 'name="identifier"');
    assertStringIncludes(page, 'name="password"');
    assertStringIncludes(page, 'name="next" value="/account"');
    assertStringIncludes(page, "Invalid credentials");
    const evil = await (await site.call("/auth/login?next=//evil.example")).text();
    assertStringIncludes(evil, 'name="next" value="/"');
  });
});

Deno.test("form login sets the session cookie and /auth/me returns the user", SITE_OPTS, async () => {
  await withSite({}, async (site) => {
    const ed = await addUser(site);
    const res = await site.call("/auth/login", form({ identifier: "ed", password: PASSWORD, next: "/account" }));
    assertEquals(res.status, 303);
    assertEquals(res.headers.get("location"), "/account");
    const cookie = cookieOf(res);
    assertStringIncludes(cookie, "dune_auth=");
    assertStringIncludes(res.headers.get("set-cookie") ?? "", "HttpOnly");

    const me = await site.call("/auth/me", { headers: { cookie } });
    assertEquals(me.status, 200);
    const body = await me.json();
    assertEquals(body.id, ed.id);
    assertEquals(body.email, "ed@example.test");
    assertEquals("passwordHash" in body, false, "never leak the hash");
  });
});

Deno.test("JSON login works, by email or username, and answers with JSON", SITE_OPTS, async () => {
  await withSite({}, async (site) => {
    await addUser(site);
    for (const identifier of ["ed", "ed@example.test", "ED@Example.Test"]) {
      const res = await site.call("/auth/login", jsonBody({ identifier, password: PASSWORD }));
      assertEquals(res.status, 200, identifier);
      assertEquals(await res.json(), { ok: true, next: "/" });
      assertStringIncludes(cookieOf(res), "dune_auth=");
    }
  });
});

Deno.test(
  "every failure looks the same: wrong password, unknown user, disabled, non-local, no password",
  SITE_OPTS,
  async () => {
    await withSite({}, async (site) => {
      await addUser(site);
      await addUser(site, { email: "off@example.test", username: "off", enabled: false });
      await addUser(site, { email: "gh@example.test", username: "gh", provider: "github", providerId: "1" });
      await addUser(site, { email: "nopw@example.test", username: "nopw", passwordHash: undefined });

      const attempts: Array<[string, string]> = [
        ["ed", "wrong password entirely"],
        ["nobody", PASSWORD],
        ["off", PASSWORD],
        ["gh", PASSWORD],
        ["nopw", PASSWORD],
      ];
      const seen = new Set<string>();
      for (const [identifier, password] of attempts) {
        const j = await site.call("/auth/login", jsonBody({ identifier, password }));
        seen.add(`${j.status} ${await j.text()} ${j.headers.get("set-cookie")}`);
        const f = await site.call("/auth/login", form({ identifier, password }));
        seen.add(`${f.status} ${f.headers.get("location")} ${f.headers.get("set-cookie")}`);
      }
      assertEquals(seen.size, 2, `one JSON shape and one form shape, got ${[...seen].join(" | ")}`);
      assert([...seen].some((s) => s.startsWith("401 ") && s.includes("Invalid credentials")));
      assert([...seen].some((s) => s.startsWith("303 /auth/login?error=invalid")));
    });
  },
);

Deno.test("a cross-origin POST is refused", SITE_OPTS, async () => {
  await withSite({}, async (site) => {
    await addUser(site);
    const res = await site.call("/auth/login", {
      ...form({ identifier: "ed", password: PASSWORD }),
      headers: { origin: "https://evil.example", "content-type": "application/x-www-form-urlencoded" },
    });
    assertEquals(res.status, 403);
    assertEquals(res.headers.get("set-cookie"), null);
  });
});

Deno.test("next only ever lands on a same-site path", SITE_OPTS, async () => {
  await withSite({}, async (site) => {
    await addUser(site);
    for (const bad of ["//evil.example", "/\\evil.example", "https://evil.example/x", "javascript:alert(1)", "/a\r\nSet-Cookie: x=1"]) {
      const res = await site.call("/auth/login", form({ identifier: "ed", password: PASSWORD, next: bad }));
      assertEquals(res.headers.get("location"), "/", JSON.stringify(bad));
    }
    const ok = await site.call("/auth/login", form({ identifier: "ed", password: PASSWORD, next: "/members/area?x=1#top" }));
    assertEquals(ok.headers.get("location"), "/members/area?x=1#top");
  });
});

Deno.test("sanitizeNext: unit cases", () => {
  assertEquals(sanitizeNext(null), "/");
  assertEquals(sanitizeNext(""), "/");
  assertEquals(sanitizeNext("/ok"), "/ok");
  assertEquals(sanitizeNext("/ok?a=1&b=2"), "/ok?a=1&b=2");
  assertEquals(sanitizeNext("//host"), "/");
  assertEquals(sanitizeNext("/\\host"), "/");
  assertEquals(sanitizeNext("ok"), "/");
  assertEquals(sanitizeNext("http://x"), "/");
  assertEquals(sanitizeNext("/" + "a".repeat(3000)), "/");
  assertEquals(sanitizeNext("/a b"), "/");
});

Deno.test("repeated failures lock the identifier, including one that does not exist", SITE_OPTS, async () => {
  await withSite({}, async (site) => {
    await addUser(site);
    for (const identifier of ["ed", "ghost"]) {
      for (let i = 0; i < PASSWORD_LOGIN_LOCKOUT_THRESHOLD; i++) {
        const res = await site.call("/auth/login", jsonBody({ identifier, password: "nope" }));
        assertEquals(res.status, 401, `${identifier} attempt ${i + 1}`);
      }
      // Locked: even the right password is refused, and an unknown name behaves identically.
      const locked = await site.call("/auth/login", jsonBody({ identifier, password: PASSWORD }));
      assertEquals(locked.status, 429, identifier);
      assertEquals(locked.headers.get("set-cookie"), null);
    }
  });
});

Deno.test("a successful login clears the failure count", SITE_OPTS, async () => {
  await withSite({}, async (site) => {
    await addUser(site);
    for (let i = 0; i < PASSWORD_LOGIN_LOCKOUT_THRESHOLD - 1; i++) {
      await site.call("/auth/login", jsonBody({ identifier: "ed", password: "nope" }));
    }
    assertEquals((await site.call("/auth/login", jsonBody({ identifier: "ed", password: PASSWORD }))).status, 200);
    for (let i = 0; i < PASSWORD_LOGIN_LOCKOUT_THRESHOLD - 1; i++) {
      assertEquals((await site.call("/auth/login", jsonBody({ identifier: "ed", password: "nope" }))).status, 401);
    }
  });
});

Deno.test("one client address is rate limited across identifiers; a form shows the page with 429", SITE_OPTS, async () => {
  await withSite({}, async (site) => {
    const ip = "203.0.113.9";
    for (let i = 0; i < PASSWORD_LOGIN_IP_LIMIT; i++) {
      const res = await site.call("/auth/login", { ...jsonBody({ identifier: `u${i}`, password: "x" }), ip });
      assertEquals(res.status, 401, `attempt ${i + 1}`);
    }
    const limited = await site.call("/auth/login", { ...jsonBody({ identifier: "another", password: "x" }), ip });
    assertEquals(limited.status, 429);
    assertNotEquals(limited.headers.get("retry-after"), null);

    const page = await site.call("/auth/login", { ...form({ identifier: "another", password: "x" }), ip });
    assertEquals(page.status, 429);
    assertStringIncludes(await page.text(), "Too many attempts");

    // Another address is unaffected.
    const other = await site.call("/auth/login", { ...jsonBody({ identifier: "u0", password: "x" }), ip: "198.51.100.2" });
    assertEquals(other.status, 401);
  });
});

Deno.test("a hash below the current cost is upgraded on a successful login", SITE_OPTS, async () => {
  await withSite({}, async (site) => {
    // A valid hash at a lower (but still accepted) iteration count.
    const iterations = 100_000;
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(PASSWORD), { name: "PBKDF2" }, false, ["deriveBits"]);
    const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, key, 256));
    const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
    const legacy = `pbkdf2:${iterations}:${hex(salt)}:${hex(bits)}`;
    assert(needsRehash(legacy));
    const user = await addUser(site, { passwordHash: legacy });

    const res = await site.call("/auth/login", jsonBody({ identifier: "ed", password: PASSWORD }));
    assertEquals(res.status, 200);
    const after = await site.users.getById(user.id);
    assert(after?.passwordHash && !needsRehash(after.passwordHash), "upgraded to the current cost");
    assertNotEquals(after!.passwordHash, DUMMY_HASH);
    // The new hash still verifies.
    assertEquals((await site.call("/auth/login", jsonBody({ identifier: "ed", password: PASSWORD }))).status, 200);
  });
});

Deno.test("user_store: session cannot hold passwords: the route stays off", SITE_OPTS, async () => {
  await withSite({ userStore: "session" }, async (site) => {
    const res = await site.call("/auth/login", jsonBody({ identifier: "ed", password: PASSWORD }));
    assertEquals(res.status, 404);
  });
});

Deno.test("a theme's templates/login.tsx renders the page, with the view as frontmatter", SITE_OPTS, async () => {
  const theme = {
    "theme.yaml": "name: t\n",
    "templates/default.tsx": `/** @jsxImportSource preact */\nexport default function T() { return <p>default</p>; }\n`,
    "templates/login.tsx": `/** @jsxImportSource preact */
export default function Login({ page }: any) {
  const v = page.frontmatter;
  return <main id="themed-login" data-error={v.error ?? ""} data-next={v.next} data-password={String(v.passwordLogin)}>
    <h1>Sign in to {"the club"}</h1>
  </main>;
}
`,
  };
  await withSite({ theme }, async (site) => {
    const res = await site.call("/auth/login?error=invalid&next=/inside");
    assertEquals(res.status, 200);
    const html = await res.text();
    assertStringIncludes(html, 'id="themed-login"');
    assertStringIncludes(html, 'data-error="invalid"');
    assertStringIncludes(html, 'data-next="/inside"');
    assertStringIncludes(html, 'data-password="true"');
  });
});

Deno.test("a theme without templates/login.tsx falls back to the built-in page", SITE_OPTS, async () => {
  const theme = {
    "theme.yaml": "name: t\n",
    "templates/default.tsx": `/** @jsxImportSource preact */\nexport default function T() { return <p>default</p>; }\n`,
  };
  await withSite({ theme }, async (site) => {
    const html = await (await site.call("/auth/login")).text();
    assertStringIncludes(html, 'name="identifier"');
  });
});

Deno.test("through createDuneApp() with the admin off: log in, then /auth/me", SITE_OPTS, async () => {
  const { createDuneApp } = await import("../../src/runtime/server.ts");
  const root = await Deno.makeTempDir({ prefix: "dune_test_pw_login_app_" });
  try {
    await Deno.mkdir(join(root, "content", "01.home"), { recursive: true });
    await Deno.writeTextFile(join(root, "content", "01.home", "default.md"), "---\ntitle: Home\n---\n\nHello\n");
    await Deno.mkdir(join(root, "config"), { recursive: true });
    await Deno.writeTextFile(
      join(root, "config", "site.yaml"),
      `title: Test Site\nurl: ${ORIGIN}\nauth:\n  mode: dune\n  providers:\n    password:\n      enabled: true\n`,
    );
    await Deno.writeTextFile(join(root, "config", "system.yaml"), "admin:\n  enabled: false\n");
    const users = createLocalUserStore({ storage: createStorage({ rootDir: root }), usersDir: "data/users" });
    await users.create({
      email: "ed@example.test",
      username: "ed",
      provider: "local",
      passwordHash: await hashPassword(PASSWORD),
      roles: ["member"],
    });
    const ctx = await bootstrap(root, {});
    const { app } = await createDuneApp(ctx, { root, port: 0, dev: false });
    const handler = app.handler();
    const req = (path: string, init?: RequestInit) => handler(new Request(new URL(path, ORIGIN), init));

    assertEquals((await req("/auth/me")).status, 401);
    const bad = await req("/auth/login", jsonBody({ identifier: "ed", password: "wrong" }));
    assertEquals(bad.status, 401);
    const good = await req("/auth/login", jsonBody({ identifier: "ed", password: PASSWORD }));
    assertEquals(good.status, 200);
    const me = await req("/auth/me", { headers: { cookie: cookieOf(good) } });
    assertEquals(me.status, 200);
    assertEquals((await me.json()).email, "ed@example.test");
    // The standard security headers cover the new route too.
    assertEquals(good.headers.get("x-content-type-options"), "nosniff");
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});
