/**
 * Auth middleware — extract session from cookies, validate, check permissions.
 */

import type { SessionManager } from "./sessions.ts";
import type { UserManager } from "./users.ts";
import type { AdminPermission, AuthResult } from "../types.ts";
import { ROLE_PERMISSIONS } from "../types.ts";

export interface AuthMiddlewareConfig {
  sessions: SessionManager;
  users: UserManager;
  /** Cookie name for the session ID */
  cookieName?: string;
  /**
   * Whether to set the Secure flag on session cookies.
   * Defaults to true. Set to false only in local HTTP dev environments.
   * Note: browsers exempt localhost from the Secure restriction, so leaving
   * this true is safe even in development on most modern browsers.
   */
  secure?: boolean;
}

export interface AuthMiddleware {
  /** Extract and validate session from request. Returns auth result. */
  authenticate(req: Request): Promise<AuthResult>;
  /** Check if the authenticated user has a specific permission */
  hasPermission(authResult: AuthResult, permission: AdminPermission): boolean;
  /** Create a session cookie value for Set-Cookie header */
  createSessionCookie(sessionId: string, maxAge: number): string;
  /** Create an expired cookie to clear the session */
  clearSessionCookie(): string;
}

export function createAuthMiddleware(config: AuthMiddlewareConfig): AuthMiddleware {
  const { sessions, users } = config;
  const cookieName = config.cookieName ?? "dune_session";
  const secure = config.secure !== false; // default true

  async function authenticate(req: Request): Promise<AuthResult> {
    // Extract session ID from cookies
    const cookieHeader = req.headers.get("Cookie") ?? "";
    const sessionId = parseCookie(cookieHeader, cookieName);

    if (!sessionId) {
      return { authenticated: false, error: "No session cookie" };
    }

    // Validate session
    const session = await sessions.get(sessionId);
    if (!session) {
      return { authenticated: false, error: "Invalid or expired session" };
    }

    // Load user
    const user = await users.getById(session.userId);
    if (!user) {
      return { authenticated: false, error: "User not found" };
    }

    if (!user.enabled) {
      return { authenticated: false, error: "Account disabled" };
    }

    return { authenticated: true, user, session };
  }

  function hasPermission(authResult: AuthResult, permission: AdminPermission): boolean {
    if (!authResult.authenticated || !authResult.user) return false;
    const permissions = ROLE_PERMISSIONS[authResult.user.role];
    return permissions.includes(permission);
  }

  function createSessionCookie(sessionId: string, maxAge: number): string {
    const secureFlag = secure ? "; Secure" : "";
    return `${cookieName}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureFlag}`;
  }

  function clearSessionCookie(): string {
    const secureFlag = secure ? "; Secure" : "";
    return `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag}`;
  }

  return { authenticate, hasPermission, createSessionCookie, clearSessionCookie };
}

/**
 * Parse a specific cookie value from a Cookie header.
 */
function parseCookie(header: string, name: string): string | null {
  const cookies = header.split(";").map((c) => c.trim());
  for (const cookie of cookies) {
    const [key, ...rest] = cookie.split("=");
    if (key.trim() === name) {
      return rest.join("=").trim();
    }
  }
  return null;
}
