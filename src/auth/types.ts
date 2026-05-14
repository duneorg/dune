/**
 * Public auth types — site visitor accounts, distinct from admin users.
 */

/** A site visitor account. No passwords — OAuth and magic link only. */
export interface SiteUser {
  id: string;           // UUID
  email: string;
  name?: string;
  avatarUrl?: string;
  provider: string;     // "github" | "google" | "discord" | "magic" | "local"
  providerId?: string;  // provider's user ID (for OAuth)
  roles: string[];      // custom roles, e.g. ["member", "subscriber"]
  createdAt: number;    // ms timestamp
  lastSeenAt: number;
  enabled: boolean;
  /**
   * Stripe customer ID assigned after a successful checkout.
   * Used by the billing portal handler — never accepted from client input.
   */
  stripeCustomerId?: string;
}

export type SiteUserCreate = Omit<SiteUser, "id" | "createdAt" | "lastSeenAt" | "enabled"> & {
  enabled?: boolean;
};

/**
 * Header name used by the public auth middleware to communicate the resolved
 * SiteUser to downstream handlers (content gating, API guards, etc.).
 *
 * The middleware serialises the user as JSON into this header after validating
 * the session cookie. Treat as trusted only when set by the same process —
 * a reverse proxy should strip it from inbound external requests.
 *
 * @internal
 */
export const SITE_USER_HEADER = "x-dune-site-user";

/**
 * Extract the SiteUser from a request, if one was injected by the public auth
 * middleware. Returns null when the user is unauthenticated or the header is
 * absent or malformed.
 */
export function getSiteUser(req: Request): SiteUser | null {
  const raw = req.headers.get(SITE_USER_HEADER);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.id === "string" &&
      Array.isArray(parsed.roles)
    ) {
      return parsed as SiteUser;
    }
    return null;
  } catch {
    return null;
  }
}

/** Public user session stored in the site session directory. */
export interface SiteSession {
  id: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
  ip?: string;
}
