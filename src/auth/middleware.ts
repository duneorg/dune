/**
 * Public site auth middleware.
 *
 * Reads the `dune_auth` session cookie (or Bearer token in external-JWT mode)
 * and populates `ctx.state.siteUser` on every request. Does NOT redirect —
 * individual routes decide what to do with a null siteUser.
 *
 * Sessions are backed by the same SessionStore/SessionManager mechanism
 * admin sessions use (src/session/mod.ts, dec-identity-unification Phase
 * 5c) — local/KV/Redis, chosen the same way via system.session_store.
 * Public sessions live in a separate directory/key namespace from admin
 * sessions ({runtimeDir}/site-sessions vs {runtimeDir}/sessions) so the two
 * don't collide, even though the storage mechanism is identical.
 */

import type { User } from "./types.ts";
import type { UserStore } from "./user-store.ts";
import type { ExternalJwtOptions } from "./jwt.ts";
import { verifyExternalJwt } from "./jwt.ts";
import type { SessionManager } from "../session/mod.ts";

export const SITE_COOKIE_NAME = "dune_auth";
export const OAUTH_STATE_COOKIE = "dune_oauth_state";
/**
 * Carries the linking user's id through an account-linking OAuth flow.
 * Unsigned, like OAUTH_STATE_COOKIE — its security comes from being
 * httpOnly + Secure + SameSite=Lax + short-lived (only the server can set
 * or read it), the same guarantee the state cookie already relies on, not
 * a cryptographic signature. Set only by oauthLinkStart(); read and
 * cleared by oauthCallback() when present.
 */
export const OAUTH_LINK_COOKIE = "dune_oauth_link_user";

export interface SiteAuthMiddlewareConfig {
  userStore: UserStore;
  sessions: SessionManager;
  mode?: "dune" | "external-jwt";
  jwt?: ExternalJwtOptions;
  secure?: boolean;
  sessionLifetime?: number; // seconds, default 30 days
  trustForwardedFor?: boolean;
}

export interface SiteAuthMiddleware {
  /** Populate ctx.state.siteUser — returns User or null */
  resolveUser(req: Request): Promise<User | null>;
  /** Create a session and return a Set-Cookie header value */
  createSessionCookie(sessionId: string): string;
  /** Return a Set-Cookie header value that clears the session cookie */
  clearSessionCookie(): string;
  /** Create a new session for a user, return session ID */
  createSession(userId: string, ip?: string, embeddedUser?: User): Promise<string>;
  /** Destroy a session */
  destroySession(sessionId: string): Promise<void>;
  /** Build an OAuth state cookie (10 min) */
  createOAuthStateCookie(state: string): string;
  /** Clear the OAuth state cookie */
  clearOAuthStateCookie(): string;
  /** Build the OAuth account-linking intent cookie (10 min) — see OAUTH_LINK_COOKIE. */
  createOAuthLinkCookie(userId: string): string;
  /** Clear the OAuth account-linking intent cookie */
  clearOAuthLinkCookie(): string;
}

export function createSiteAuthMiddleware(config: SiteAuthMiddlewareConfig): SiteAuthMiddleware {
  const {
    userStore,
    sessions,
    mode = "dune",
    jwt: jwtOpts,
    secure = true,
    sessionLifetime = 30 * 24 * 60 * 60, // 30 days
    trustForwardedFor = false,
  } = config;

  async function resolveUser(req: Request): Promise<User | null> {
    if (mode === "external-jwt") {
      return resolveUserFromJwt(req);
    }
    return resolveUserFromSession(req);
  }

  async function resolveUserFromSession(req: Request): Promise<User | null> {
    const cookieHeader = req.headers.get("Cookie") ?? "";
    const sessionId = parseCookie(cookieHeader, SITE_COOKIE_NAME);
    if (!sessionId) return null;

    const session = await sessions.get(sessionId);
    if (!session) return null;

    // IP binding (same logic as admin middleware)
    if (session.ip && trustForwardedFor) {
      const requestIp = req.headers.get("x-forwarded-for")?.split(",")[0].trim()
        ?? req.headers.get("x-real-ip")
        ?? undefined;
      if (requestIp && requestIp !== session.ip) return null;
    }

    // userStore: session — identity is embedded in the session, no disk lookup.
    if (session.embeddedUser) {
      return session.embeddedUser.enabled !== false ? session.embeddedUser : null;
    }

    const user = await userStore.getById(session.userId);
    if (!user || !user.enabled) return null;

    return user;
  }

  async function resolveUserFromJwt(req: Request): Promise<User | null> {
    if (!jwtOpts) return null;

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return null;
    const token = authHeader.slice(7);

    const claims = await verifyExternalJwt(token, jwtOpts);
    if (!claims) return null;

    // Upsert a synthetic User from JWT claims — no persistent record needed
    // but we provide a consistent User object to route handlers.
    const syntheticUser: User = {
      id: claims.userId,
      email: claims.email ?? "",
      provider: "external-jwt",
      roles: claims.roles ?? [],
      createdAt: 0,
      updatedAt: 0,
      lastSeenAt: Date.now(),
      enabled: true,
    };
    return syntheticUser;
  }

  function createSessionCookie(sessionId: string): string {
    const secureFlag = secure ? "; Secure" : "";
    return `${SITE_COOKIE_NAME}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionLifetime}${secureFlag}`;
  }

  function clearSessionCookie(): string {
    const secureFlag = secure ? "; Secure" : "";
    return `${SITE_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag}`;
  }

  async function createSession(userId: string, ip?: string, embeddedUser?: User): Promise<string> {
    const session = await sessions.create(userId, ip, embeddedUser);
    return session.id;
  }

  async function destroySession(sessionId: string): Promise<void> {
    await sessions.revoke(sessionId);
  }

  function createOAuthStateCookie(state: string): string {
    const secureFlag = secure ? "; Secure" : "";
    // 10 min lifetime for state cookie
    return `${OAUTH_STATE_COOKIE}=${state}; Path=/auth; HttpOnly; SameSite=Lax; Max-Age=600${secureFlag}`;
  }

  function clearOAuthStateCookie(): string {
    const secureFlag = secure ? "; Secure" : "";
    return `${OAUTH_STATE_COOKIE}=; Path=/auth; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag}`;
  }

  function createOAuthLinkCookie(userId: string): string {
    const secureFlag = secure ? "; Secure" : "";
    return `${OAUTH_LINK_COOKIE}=${userId}; Path=/auth; HttpOnly; SameSite=Lax; Max-Age=600${secureFlag}`;
  }

  function clearOAuthLinkCookie(): string {
    const secureFlag = secure ? "; Secure" : "";
    return `${OAUTH_LINK_COOKIE}=; Path=/auth; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag}`;
  }

  return {
    resolveUser,
    createSessionCookie,
    clearSessionCookie,
    createSession,
    destroySession,
    createOAuthStateCookie,
    clearOAuthStateCookie,
    createOAuthLinkCookie,
    clearOAuthLinkCookie,
  };
}

function parseCookie(header: string, name: string): string | null {
  const cookies = header.split(";").map((c) => c.trim());
  for (const cookie of cookies) {
    const [key, ...rest] = cookie.split("=");
    if (key.trim() === name) return rest.join("=").trim();
  }
  return null;
}
