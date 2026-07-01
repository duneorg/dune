/**
 * Public site auth middleware.
 *
 * Reads the `dune_auth` session cookie (or Bearer token in external-JWT mode)
 * and populates `ctx.state.siteUser` on every request. Does NOT redirect —
 * individual routes decide what to do with a null siteUser.
 *
 * Session files live in {runtimeDir}/site-sessions/, keyed by session ID.
 * Key prefix is distinct from admin sessions which live in {runtimeDir}/sessions/.
 */

import { encodeHex } from "@std/encoding/hex";
import type { StorageAdapter } from "../storage/types.ts";
import type { SiteSession, SiteUser } from "./types.ts";
import type { SiteUserStore } from "./user-store.ts";
import type { ExternalJwtOptions } from "./jwt.ts";
import { verifyExternalJwt } from "./jwt.ts";

export const SITE_COOKIE_NAME = "dune_auth";
export const OAUTH_STATE_COOKIE = "dune_oauth_state";

export interface SiteSessionManager {
  create(userId: string, ip?: string, embeddedUser?: SiteUser): Promise<SiteSession>;
  get(sessionId: string): Promise<SiteSession | null>;
  revoke(sessionId: string): Promise<void>;
}

export interface SiteAuthMiddlewareConfig {
  userStore: SiteUserStore;
  sessions: SiteSessionManager;
  mode?: "dune" | "external-jwt";
  jwt?: ExternalJwtOptions;
  secure?: boolean;
  sessionLifetime?: number; // seconds, default 30 days
  trustForwardedFor?: boolean;
}

export interface SiteAuthMiddleware {
  /** Populate ctx.state.siteUser — returns SiteUser or null */
  resolveUser(req: Request): Promise<SiteUser | null>;
  /** Create a session and return a Set-Cookie header value */
  createSessionCookie(sessionId: string): string;
  /** Return a Set-Cookie header value that clears the session cookie */
  clearSessionCookie(): string;
  /** Create a new session for a user, return session ID */
  createSession(userId: string, ip?: string, embeddedUser?: SiteUser): Promise<string>;
  /** Destroy a session */
  destroySession(sessionId: string): Promise<void>;
  /** Build an OAuth state cookie (10 min) */
  createOAuthStateCookie(state: string): string;
  /** Clear the OAuth state cookie */
  clearOAuthStateCookie(): string;
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

  async function resolveUser(req: Request): Promise<SiteUser | null> {
    if (mode === "external-jwt") {
      return resolveUserFromJwt(req);
    }
    return resolveUserFromSession(req);
  }

  async function resolveUserFromSession(req: Request): Promise<SiteUser | null> {
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

  async function resolveUserFromJwt(req: Request): Promise<SiteUser | null> {
    if (!jwtOpts) return null;

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return null;
    const token = authHeader.slice(7);

    const claims = await verifyExternalJwt(token, jwtOpts);
    if (!claims) return null;

    // Upsert a synthetic SiteUser from JWT claims — no persistent record needed
    // but we provide a consistent SiteUser object to route handlers.
    const syntheticUser: SiteUser = {
      id: claims.userId,
      email: claims.email ?? "",
      provider: "external-jwt",
      roles: claims.roles ?? [],
      createdAt: 0,
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

  async function createSession(userId: string, ip?: string, embeddedUser?: SiteUser): Promise<string> {
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

  return {
    resolveUser,
    createSessionCookie,
    clearSessionCookie,
    createSession,
    destroySession,
    createOAuthStateCookie,
    clearOAuthStateCookie,
  };
}

/**
 * Create a site session manager backed by the storage adapter.
 * Sessions stored in {sessionsDir}/{id}.json.
 */
export function createSiteSessionManager(config: {
  storage: StorageAdapter;
  sessionsDir: string;
  /** Session lifetime in milliseconds — canonical since v0.26. */
  lifetimeMs: number;
  /**
   * @deprecated Use `lifetimeMs` (milliseconds) instead.
   * Kept for one minor version; removed in v0.27.
   */
  lifetime?: number;
}): SiteSessionManager {
  const { storage, sessionsDir } = config;
  const lifetimeMs = config.lifetimeMs ?? ((config.lifetime ?? 0) * 1000);

  async function create(userId: string, ip?: string, embeddedUser?: SiteUser): Promise<SiteSession> {
    const id = await generateSessionId();
    const now = Date.now();
    const session: SiteSession = {
      id,
      userId,
      createdAt: now,
      expiresAt: now + lifetimeMs,
      ip,
      ...(embeddedUser !== undefined ? { embeddedUser } : {}),
    };
    await storage.write(
      `${sessionsDir}/${id}.json`,
      new TextEncoder().encode(JSON.stringify(session)),
    );
    return session;
  }

  async function get(sessionId: string): Promise<SiteSession | null> {
    const path = `${sessionsDir}/${sessionId}.json`;
    try {
      if (!(await storage.exists(path))) return null;
      const data = await storage.read(path);
      const session = JSON.parse(new TextDecoder().decode(data)) as SiteSession;
      if (session.expiresAt < Date.now()) {
        await storage.delete(path);
        return null;
      }
      return session;
    } catch {
      return null;
    }
  }

  async function revoke(sessionId: string): Promise<void> {
    try {
      await storage.delete(`${sessionsDir}/${sessionId}.json`);
    } catch {
      // already gone — fine
    }
  }

  return { create, get, revoke };
}

async function generateSessionId(): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return encodeHex(bytes);
}

function parseCookie(header: string, name: string): string | null {
  const cookies = header.split(";").map((c) => c.trim());
  for (const cookie of cookies) {
    const [key, ...rest] = cookie.split("=");
    if (key.trim() === name) return rest.join("=").trim();
  }
  return null;
}
