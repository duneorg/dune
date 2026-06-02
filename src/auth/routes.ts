/**
 * Public auth route handlers.
 *
 * Factory function that returns a record of route handlers to be wired
 * by mount.ts. Routes follow the admin mount.ts pattern — plain Request/Response,
 * no Fresh-specific types needed here.
 *
 * Routes:
 *   GET  /auth/login               — login page (provider selection)
 *   GET  /auth/logout              — destroy session, redirect to /
 *   GET  /auth/{provider}          — initiate OAuth flow
 *   GET  /auth/{provider}/callback — OAuth callback
 *   POST /auth/magic/send          — send magic link email
 *   GET  /auth/magic               — verify token, create session
 *   GET  /auth/me                  — JSON: current user or 401
 */

import { encodeHex } from "@std/encoding/hex";
import type { SiteUser } from "./types.ts";
import type { SiteUserStore } from "./user-store.ts";
import type { SiteAuthMiddleware } from "./middleware.ts";
import { OAUTH_STATE_COOKIE } from "./middleware.ts";
import { createMagicLink, verifyMagicToken, type MagicTokenStore } from "./magic-link.ts";
import type { OAuthProvider } from "./providers/types.ts";
import { RateLimiter, clientIp, rateLimitResponse } from "../security/rate-limit.ts";

export interface AuthRoutesConfig {
  userStore: SiteUserStore;
  middleware: SiteAuthMiddleware;
  providers: Map<string, OAuthProvider>;
  magicLinkEnabled: boolean;
  magicLinkSecret: string;
  siteUrl: string;
  mode: "dune" | "external-jwt";
  /** Storage tier for user records. "session" means no persistent records — identity is embedded in the session cookie. "db" uses the database-backed store. */
  userStoreType?: "local" | "session" | "db";
  sendEmail?: (to: string, subject: string, text: string, html: string) => Promise<void>;
  trustForwardedFor?: boolean;
  /**
   * Optional single-use token store for magic links.
   * When provided, each magic link token can only be used once.
   * Recommended for production deployments.
   */
  magicTokenStore?: MagicTokenStore;
}

export interface AuthRouteHandlers {
  login: (req: Request, siteUser: SiteUser | null) => Response;
  logout: (req: Request) => Promise<Response>;
  oauthStart: (req: Request, provider: string) => Response;
  oauthCallback: (req: Request, provider: string) => Promise<Response>;
  magicSend: (req: Request) => Promise<Response>;
  magicVerify: (req: Request) => Promise<Response>;
  me: (req: Request, siteUser: SiteUser | null) => Response;
}

// Magic link send: 5 requests per 10 minutes per IP
const magicLinkLimiter = new RateLimiter(5, 10 * 60 * 1000);

export function createAuthRoutes(config: AuthRoutesConfig): AuthRouteHandlers {
  const {
    userStore,
    middleware,
    providers,
    magicLinkEnabled,
    magicLinkSecret,
    siteUrl,
    mode,
    userStoreType = "local",
    sendEmail,
    trustForwardedFor = false,
    magicTokenStore,
  } = config;

  // ── Login page ─────────────────────────────────────────────────────────────

  function login(req: Request, siteUser: SiteUser | null): Response {
    if (siteUser) {
      // Already logged in — honour a sanitised ?next= redirect target.
      const url = new URL(req.url);
      const next = sanitizeNext(url.searchParams.get("next"));
      return new Response(null, { status: 302, headers: { Location: next } });
    }

    if (mode === "external-jwt") {
      return new Response(
        loginHtml([], false, "This site uses external authentication. Please use your provider's login."),
        { headers: { "Content-Type": "text/html; charset=utf-8" } },
      );
    }

    const providerNames = [...providers.keys()];
    return new Response(loginHtml(providerNames, magicLinkEnabled), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  // ── Logout ─────────────────────────────────────────────────────────────────

  async function logout(req: Request): Promise<Response> {
    const cookieHeader = req.headers.get("Cookie") ?? "";
    const sessionId = parseCookie(cookieHeader, "dune_auth");
    if (sessionId) {
      await middleware.destroySession(sessionId);
    }
    return new Response(null, {
      status: 302,
      headers: {
        Location: "/",
        "Set-Cookie": middleware.clearSessionCookie(),
      },
    });
  }

  // ── OAuth start ────────────────────────────────────────────────────────────

  function oauthStart(req: Request, providerName: string): Response {
    const provider = providers.get(providerName);
    if (!provider) {
      return new Response("Unknown provider", { status: 404 });
    }

    const state = generateState();
    const redirectUri = `${siteUrl}/auth/${providerName}/callback`;
    const url = provider.authorizationUrl(state, redirectUri);

    return new Response(null, {
      status: 302,
      headers: {
        Location: url,
        "Set-Cookie": middleware.createOAuthStateCookie(state),
      },
    });
  }

  // ── OAuth callback ─────────────────────────────────────────────────────────

  async function oauthCallback(req: Request, providerName: string): Promise<Response> {
    const provider = providers.get(providerName);
    if (!provider) {
      return new Response("Unknown provider", { status: 404 });
    }

    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");

    if (!code || !state) {
      return new Response("Missing code or state", { status: 400 });
    }

    // Verify state cookie
    const cookieHeader = req.headers.get("Cookie") ?? "";
    const storedState = parseCookie(cookieHeader, OAUTH_STATE_COOKIE);
    if (!storedState || storedState !== state) {
      return new Response("Invalid state — CSRF check failed", { status: 400 });
    }

    try {
      const redirectUri = `${siteUrl}/auth/${providerName}/callback`;
      const { accessToken } = await provider.exchangeCode(code, redirectUri);
      const profile = await provider.getUser(accessToken);

      const ip = clientIp(req, { trustForwardedFor });
      let sessionId: string;

      if (userStoreType === "session") {
        // No persistent user record — synthesise identity from OAuth claims and
        // embed it in the session. User ID is stable across sessions for the
        // same OAuth identity: "{provider}:{providerId}".
        const syntheticUser: SiteUser = {
          id: `${providerName}:${profile.id}`,
          email: profile.email,
          name: profile.name,
          avatarUrl: profile.avatarUrl,
          provider: providerName,
          providerId: profile.id,
          roles: [],
          createdAt: Date.now(),
          lastSeenAt: Date.now(),
          enabled: true,
        };
        sessionId = await middleware.createSession(syntheticUser.id, ip || undefined, syntheticUser);
      } else {
        // userStoreType: "local" — upsert a persistent user record.

        let user = await userStore.getByProvider(providerName, profile.id);
        const foundByProvider = !!user;

        if (!user) {
          user = await userStore.getByEmail(profile.email);
        }

        if (user && !foundByProvider) {
          // An account with this email already exists but was created with a
          // different authentication method (e.g. magic link or another OAuth
          // provider). Auto-linking would allow account takeover — an attacker
          // who creates an OAuth account sharing the victim's email address
          // would silently inherit their session.
          //
          // Require the user to log in with their original method and link
          // accounts explicitly through their account settings.
          return new Response(
            loginHtml(
              [...providers.keys()],
              magicLinkEnabled,
              `An account with ${escHtml(profile.email)} already exists. ` +
                `Please log in with your original method to link this ${providerName} account.`,
            ),
            { status: 409, headers: { "Content-Type": "text/html; charset=utf-8" } },
          );
        }

        if (user) {
          // Found by provider — update profile info (e.g. avatar may have changed).
          await userStore.update(user.id, {
            name: profile.name ?? user.name,
            avatarUrl: profile.avatarUrl ?? user.avatarUrl,
            lastSeenAt: Date.now(),
          });
          user = (await userStore.getById(user.id))!;
        } else {
          // Create new user
          user = await userStore.create({
            email: profile.email,
            name: profile.name,
            avatarUrl: profile.avatarUrl,
            provider: providerName,
            providerId: profile.id,
            roles: [],
          });
        }

        if (!user.enabled) {
          return new Response("Account disabled", { status: 403 });
        }

        sessionId = await middleware.createSession(user.id, ip || undefined);
      }

      // OAuth state does not carry a `next` param (adding it would require
      // encoding it in the state cookie). Fall back to "/" for now; callers
      // that need post-OAuth redirect should use a server-side session key.
      return new Response(null, {
        status: 302,
        headers: {
          Location: "/",
          "Set-Cookie": [
            middleware.createSessionCookie(sessionId),
            middleware.clearOAuthStateCookie(),
          ].join(", "),
        },
      });
    } catch (err) {
      console.error(`[dune/auth] OAuth callback error (${providerName}):`, err);
      return new Response("Authentication failed", { status: 500 });
    }
  }

  // ── Magic link send ────────────────────────────────────────────────────────

  async function magicSend(req: Request): Promise<Response> {
    if (!magicLinkEnabled) {
      return new Response("Magic link not enabled", { status: 404 });
    }

    // Rate limit by IP
    const ip = clientIp(req, { trustForwardedFor });
    if (!magicLinkLimiter.check(ip)) {
      return rateLimitResponse(magicLinkLimiter.retryAfter(ip));
    }

    let email: string;
    try {
      const body = await req.json() as { email?: unknown };
      email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    } catch {
      return new Response(JSON.stringify({ error: "Invalid request body" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!isValidEmail(email)) {
      return new Response(JSON.stringify({ error: "Invalid email address" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Always return 200 — don't reveal whether email exists
    try {
      const link = await createMagicLink(email, magicLinkSecret, siteUrl);

      if (sendEmail) {
        const text = `Click the link below to log in:\n\n${link}\n\nThis link expires in 15 minutes.`;
        const html = magicEmailHtml(link);
        await sendEmail(email, "Your login link", text, html).catch((err) => {
          console.error("[dune/auth] Failed to send magic link email:", err);
        });
      } else {
        // No email provider — log for development convenience only.
        // Truncate to avoid full tokens appearing in log aggregation tools.
        const devLink = link.length > 100 ? link.slice(0, 100) + "…" : link;
        console.log(`[dune/auth] Magic link for ${email}: ${devLink}`);
      }
    } catch (err) {
      console.error("[dune/auth] Magic link generation error:", err);
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── Magic link verify ─────────────────────────────────────────────────────

  async function magicVerify(req: Request): Promise<Response> {
    if (!magicLinkEnabled) {
      return new Response("Magic link not enabled", { status: 404 });
    }

    const url = new URL(req.url);
    const token = url.searchParams.get("token");
    if (!token) {
      return loginErrorResponse("Missing token");
    }

    const result = await verifyMagicToken(token, magicLinkSecret, magicTokenStore);
    if (!result) {
      return loginErrorResponse("Invalid or expired link — please request a new one");
    }

    const { email } = result;
    const ip = clientIp(req, { trustForwardedFor });
    let sessionId: string;

    if (userStoreType === "session") {
      // No persistent user record — synthesise identity from the verified email.
      // User ID is stable: "magic:{email}".
      const syntheticUser: SiteUser = {
        id: `magic:${email}`,
        email,
        provider: "magic",
        roles: [],
        createdAt: Date.now(),
        lastSeenAt: Date.now(),
        enabled: true,
      };
      sessionId = await middleware.createSession(syntheticUser.id, ip || undefined, syntheticUser);
    } else {
      // userStoreType: "local" — upsert a persistent user record.
      let user = await userStore.getByEmail(email);
      if (!user) {
        user = await userStore.create({
          email,
          provider: "magic",
          roles: [],
        });
      } else {
        await userStore.update(user.id, { lastSeenAt: Date.now() });
      }

      if (!user.enabled) {
        return new Response("Account disabled", { status: 403 });
      }

      sessionId = await middleware.createSession(user.id, ip || undefined);
    }

    // Honour a sanitised ?next= query parameter for post-verify redirect.
    const nextParam = sanitizeNext(url.searchParams.get("next"));

    return new Response(null, {
      status: 302,
      headers: {
        Location: nextParam,
        "Set-Cookie": middleware.createSessionCookie(sessionId),
      },
    });
  }

  // ── /auth/me ───────────────────────────────────────────────────────────────

  function me(_req: Request, siteUser: SiteUser | null): Response {
    if (!siteUser) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    // Strip internal fields before sending to client
    const safe = {
      id: siteUser.id,
      email: siteUser.email,
      name: siteUser.name,
      avatarUrl: siteUser.avatarUrl,
      provider: siteUser.provider,
      roles: siteUser.roles,
    };
    return new Response(JSON.stringify(safe), {
      headers: { "Content-Type": "application/json" },
    });
  }

  return { login, logout, oauthStart, oauthCallback, magicSend, magicVerify, me };
}

// ── HTML helpers ──────────────────────────────────────────────────────────────

function loginHtml(providers: string[], magicEnabled: boolean, message?: string): string {
  const providerButtons = providers.map((p) => {
    const label = p.charAt(0).toUpperCase() + p.slice(1);
    return `<a href="/auth/${p}" style="display:block;padding:10px 20px;margin:8px 0;background:#f5f5f5;border:1px solid #ddd;border-radius:4px;text-decoration:none;color:#333;text-align:center">Continue with ${label}</a>`;
  }).join("\n");

  const magicForm = magicEnabled
    ? `
<form id="magic-form" style="margin-top:16px">
  <input type="email" id="magic-email" placeholder="your@email.com" required
    style="display:block;width:100%;padding:8px;margin-bottom:8px;border:1px solid #ddd;border-radius:4px;box-sizing:border-box">
  <button type="submit" style="display:block;width:100%;padding:10px;background:#333;color:#fff;border:none;border-radius:4px;cursor:pointer">
    Send login link
  </button>
</form>
<script>
document.getElementById('magic-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('magic-email').value;
  const res = await fetch('/auth/magic/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (res.ok) {
    document.getElementById('magic-form').innerHTML = '<p style="color:#333">Check your email for a login link.</p>';
  }
});
</script>`
    : "";

  const messageHtml = message
    ? `<p style="color:#666;margin-bottom:16px">${escHtml(message)}</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Log in</title>
</head>
<body style="font-family:system-ui,sans-serif;max-width:400px;margin:80px auto;padding:0 16px">
<h1 style="font-size:1.5rem;margin-bottom:24px">Log in</h1>
${messageHtml}
${providerButtons}
${magicForm}
</body>
</html>`;
}

function magicEmailHtml(link: string): string {
  return `
<div style="font-family:system-ui,sans-serif;max-width:480px">
  <h2>Your login link</h2>
  <p>Click the button below to log in. This link expires in 15 minutes.</p>
  <a href="${escHtml(link)}" style="display:inline-block;padding:12px 24px;background:#333;color:#fff;border-radius:4px;text-decoration:none">
    Log in
  </a>
  <p style="margin-top:16px;font-size:0.85em;color:#666">
    Or copy this URL:<br>${escHtml(link)}
  </p>
</div>`.trim();
}

function loginErrorResponse(message: string): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Login error</title></head>
<body style="font-family:system-ui,sans-serif;max-width:400px;margin:80px auto;padding:0 16px">
<h1 style="font-size:1.5rem">Login error</h1>
<p>${escHtml(message)}</p>
<p><a href="/auth/login">Try again</a></p>
</body>
</html>`;
  return new Response(html, {
    status: 400,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Sanitize a `?next=` redirect target to prevent open-redirect attacks.
 *
 * Only relative paths that start with `/` and do not start with `//`
 * (scheme-relative URLs) are accepted. Everything else — external URLs,
 * `javascript:` URIs, scheme-relative URLs, data: URIs — falls back to `/`.
 *
 * Matching the admin panel's sanitizeNext pattern.
 */
function sanitizeNext(next: string | null | undefined): string {
  if (!next) return "/";
  const trimmed = next.trim();
  // Must start with "/" but not "//" (scheme-relative = external redirect).
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return "/";
  // Reject anything that looks like a protocol after stripping leading slashes.
  if (/^\/[a-zA-Z][a-zA-Z0-9+\-.]*:/.test(trimmed)) return "/";
  return trimmed;
}

function generateState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return encodeHex(bytes);
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function parseCookie(header: string, name: string): string | null {
  const cookies = header.split(";").map((c) => c.trim());
  for (const cookie of cookies) {
    const [key, ...rest] = cookie.split("=");
    if (key.trim() === name) return rest.join("=").trim();
  }
  return null;
}
