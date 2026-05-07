/** @jsxImportSource preact */
/**
 * GET  /admin/login  — login form
 * POST /admin/login  — authenticate + set session cookie
 * POST /admin/login/logout — revoke session + redirect to login
 */

import { h } from "preact";
import type { FreshContext } from "fresh";
import type { AdminState } from "../types.ts";
import { verifyPassword, DUMMY_HASH, needsRehash } from "../auth/passwords.ts";
import { findOrProvisionUser } from "../auth/provisioner.ts";
import { RateLimiter, clientIp } from "../../security/rate-limit.ts";

const loginRateLimiter = new RateLimiter(5, 15 * 60 * 1000);

// Per-account lockout: 10 failed attempts within 15 minutes locks the
// username for 15 minutes regardless of the source IP. Complements the
// per-IP rate limiter — an attacker rotating IPs can still hit the
// per-username limit, and a low-and-slow distributed attack will still
// trigger the audit alarm.
const LOGIN_LOCKOUT_THRESHOLD = 10;
const LOGIN_LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
const accountFailures = new Map<string, number[]>();

function recordAccountFailure(username: string): number {
  const now = Date.now();
  const lower = username.toLowerCase();
  const arr = accountFailures.get(lower) ?? [];
  // Drop attempts outside the rolling window
  const recent = arr.filter((t) => now - t < LOGIN_LOCKOUT_WINDOW_MS);
  recent.push(now);
  accountFailures.set(lower, recent);
  return recent.length;
}

function isAccountLocked(username: string): boolean {
  const now = Date.now();
  const arr = accountFailures.get(username.toLowerCase());
  if (!arr) return false;
  const recent = arr.filter((t) => now - t < LOGIN_LOCKOUT_WINDOW_MS);
  return recent.length >= LOGIN_LOCKOUT_THRESHOLD;
}

function clearAccountFailures(username: string): void {
  accountFailures.delete(username.toLowerCase());
}

export const handler = {
  async GET(ctx: FreshContext<AdminState>) {
    const { auth, prefix } = ctx.state.adminContext;
    // Already authenticated → redirect to dashboard
    if (ctx.state.auth?.authenticated) {
      return new Response(null, { status: 302, headers: { Location: `${prefix}/` } });
    }
    const error = ctx.url.searchParams.get("error") ?? undefined;
    const next = ctx.url.searchParams.get("next") ?? `${prefix}/`;
    return ctx.render(<LoginPage data={{ error, next, prefix }} />);
  },

  async POST(ctx: FreshContext<AdminState>) {
    const { auth, users, sessions, prefix, auditLogger, authProvider, config } = ctx.state.adminContext;
    const adminConfig = config.admin!;
    const url = ctx.url;

    // Logout sub-action
    if (url.pathname.endsWith("/logout")) {
      const authResult = ctx.state.auth;
      if (authResult?.session) {
        await sessions.revoke(authResult.session.id);
        if (authResult.user) {
          void auditLogger?.log({
            event: "auth.logout",
            actor: { userId: authResult.user.id, username: authResult.user.username, name: authResult.user.name },
            ip: null,
            userAgent: ctx.req.headers.get("user-agent"),
            target: null,
            detail: {},
            outcome: "success",
          }).catch(() => {});
        }
      }
      return new Response(null, {
        status: 302,
        headers: {
          Location: `${prefix}/login`,
          "Set-Cookie": auth.clearSessionCookie(),
        },
      });
    }

    // Login. Rate-limit / lockout key is IP-based — only honor forwarded
    // headers when the operator explicitly opts in via system.trusted_proxies.
    // Otherwise an attacker can rotate X-Forwarded-For per attempt to evade
    // the per-IP failed-login lockout.
    const trustForwardedFor = config.system?.trusted_proxies === true;
    const ip = clientIp(ctx.req, { trustForwardedFor });

    if (!loginRateLimiter.check(ip)) {
      const retryAfter = loginRateLimiter.retryAfter(ip);
      return ctx.render(<LoginPage data={{ error: `Too many login attempts. Try again in ${retryAfter} seconds.`, next: `${prefix}/`, prefix }} />, { status: 429 });
    }

    const formData = await ctx.req.formData();
    const username = (formData.get("username") as string)?.trim();
    const password = formData.get("password") as string;
    const next = (formData.get("next") as string) ?? `${prefix}/`;

    if (!username || !password) {
      return ctx.render(<LoginPage data={{ error: "Username and password required", next, prefix }} />, { status: 400 });
    }

    // Per-account lockout — independent from per-IP rate limit.
    if (isAccountLocked(username)) {
      void auditLogger?.log({
        event: "auth.login_failed",
        actor: null,
        ip: ip === "unknown" ? null : ip,
        userAgent: ctx.req.headers.get("user-agent"),
        target: { type: "user", id: username },
        detail: { username, locked: true },
        outcome: "failure",
      }).catch(() => {});
      // Use the same error message as a normal invalid-credentials response
      // so the lockout doesn't double as a username-existence oracle.
      return ctx.render(<LoginPage data={{ error: "Invalid credentials", next, prefix }} />, { status: 429 });
    }

    let user!: import("../types.ts").AdminUser;

    if (authProvider) {
      const providerUser = await authProvider.authenticate({ username, password });
      if (!providerUser) {
        recordAccountFailure(username);
        void auditLogger?.log({ event: "auth.login_failed", actor: null, ip: ip === "unknown" ? null : ip, userAgent: ctx.req.headers.get("user-agent"), target: null, detail: { username }, outcome: "failure" }).catch(() => {});
        return ctx.render(<LoginPage data={{ error: "Invalid credentials", next, prefix }} />, { status: 401 });
      }
      user = await findOrProvisionUser(providerUser, users);
    } else {
      const found = await users.getByUsername(username);
      const hashToVerify = found?.passwordHash ?? DUMMY_HASH;
      const valid = await verifyPassword(password, hashToVerify);
      if (!found || !found.enabled || !valid) {
        recordAccountFailure(username);
        void auditLogger?.log({ event: "auth.login_failed", actor: null, ip: ip === "unknown" ? null : ip, userAgent: ctx.req.headers.get("user-agent"), target: null, detail: { username }, outcome: "failure" }).catch(() => {});
        return ctx.render(<LoginPage data={{ error: "Invalid credentials", next, prefix }} />, { status: 401 });
      }
      user = found;
      // Transparently upgrade legacy (low-iteration) hashes to current cost.
      // Never blocks the login on rehash failure — login succeeded already.
      if (needsRehash(found.passwordHash)) {
        try {
          await users.changePassword(found.id, password);
        } catch {
          // Rehash is best-effort; surface in server logs but don't fail login.
        }
      }
    }

    await sessions.revokeAll(user.id);
    const session = await sessions.create(user.id, ip === "unknown" ? undefined : ip);

    // Successful login resets the per-account failure counter.
    clearAccountFailures(username);

    void auditLogger?.log({ event: "auth.login", actor: { userId: user.id, username: user.username, name: user.name }, ip: ip === "unknown" ? null : ip, userAgent: ctx.req.headers.get("user-agent"), target: null, detail: {}, outcome: "success" }).catch(() => {});

    const safeNext = next.startsWith(prefix) ? next : `${prefix}/`;
    return new Response(null, {
      status: 302,
      headers: {
        Location: safeNext,
        "Set-Cookie": auth.createSessionCookie(session.id, adminConfig.sessionLifetime),
      },
    });
  },
};

export default function LoginPage(
  { data }: { data: { error?: string; next: string; prefix: string } },
) {
  const { error, next, prefix } = data ?? {};
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Login — Dune Admin</title>
        <style>{loginCss()}</style>
      </head>
      <body class="login-body">
        <div class="login-card">
          <div class="login-header">
            <h1>🏜️ Dune</h1>
            <p>Admin Panel</p>
          </div>
          {error && <div class="alert alert-error">{error}</div>}
          <form method="POST" action={`${prefix}/login`}>
            <input type="hidden" name="next" value={next ?? `${prefix}/`} />
            <div class="form-group">
              <label for="username">Username</label>
              <input type="text" id="username" name="username" required autofocus />
            </div>
            <div class="form-group">
              <label for="password">Password</label>
              <input type="password" id="password" name="password" required />
            </div>
            <button type="submit" class="btn btn-primary" style="width:100%">Sign in</button>
          </form>
        </div>
      </body>
    </html>
  );
}

function loginCss(): string {
  return `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root { --accent: #4f46e5; --border: #e2e8f0; --bg: #f8f9fa; --surface: #fff; --text: #1a202c; --text-muted: #718096; --danger: #e53e3e; }
    body { font-family: system-ui, sans-serif; background: var(--bg); color: var(--text); }
    .login-body { display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .login-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 32px; width: 100%; max-width: 360px; }
    .login-header { text-align: center; margin-bottom: 24px; }
    .login-header h1 { font-size: 28px; margin-bottom: 4px; }
    .login-header p { color: var(--text-muted); font-size: 14px; }
    .form-group { margin-bottom: 16px; }
    label { display: block; font-size: 14px; font-weight: 500; margin-bottom: 6px; }
    input { width: 100%; padding: 8px 12px; border: 1px solid var(--border); border-radius: 6px; font-size: 14px; }
    input:focus { outline: 2px solid var(--accent); border-color: transparent; }
    .btn { display: inline-flex; align-items: center; justify-content: center; padding: 8px 16px; border-radius: 6px; font-size: 14px; font-weight: 500; border: 1px solid var(--border); background: var(--surface); cursor: pointer; color: var(--text); }
    .btn-primary { background: var(--accent); color: #fff; border-color: var(--accent); }
    .alert { padding: 10px 14px; border-radius: 6px; font-size: 14px; margin-bottom: 16px; }
    .alert-error { background: #fff5f5; border: 1px solid #fed7d7; color: var(--danger); }
  `;
}
