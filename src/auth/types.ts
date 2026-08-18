/**
 * Auth types — one unified account record shared by the admin panel
 * (@dune/plugin-admin) and public site visitors.
 *
 * Merged from the formerly-separate `AdminUser` (admin-only, password auth,
 * single closed-union role) and `SiteUser` (public-only, OAuth/magic-link,
 * generic string roles) per decisions/dec-identity-unification.md's Phase 5.
 * There is no closed role union on this type: `"admin"`/`"editor"`/`"author"`
 * are just conventional string values inside `roles`, interpreted by
 * @dune/plugin-admin's `ROLE_RANK`/`VALID_ROLES`/`highestValidRole()`
 * (src/admin/auth/provisioner.ts) — a user with none of those strings in
 * `roles` simply has no admin-panel access, the same way a public site
 * member with no matching content-gating role has none.
 */

/** A Dune account — admin panel user, public site visitor, or both. */
export interface User {
  id: string;
  email: string;
  name?: string;
  avatarUrl?: string;
  /**
   * Login name for password-based (local admin) auth. Absent for
   * OAuth/magic-link-only accounts, which have no username concept.
   */
  username?: string;
  /** PBKDF2 hash, present only for accounts with a local password. */
  passwordHash?: string;
  /** External identity provider: "local" (password) | "github" | "google" | "discord" | "magic" | ... */
  provider: string;
  /** Provider's user ID (for OAuth). */
  providerId?: string;
  /** Roles/tags, e.g. ["admin"], ["member", "subscriber"]. */
  roles: string[];
  createdAt: number; // ms timestamp
  updatedAt: number;
  lastSeenAt: number;
  enabled: boolean;
  /**
   * Stripe customer ID assigned after a successful checkout.
   * Used by the billing portal handler — never accepted from client input.
   */
  stripeCustomerId?: string;
}

/**
 * Input for creating a new {@link User} — server-generated fields are omitted.
 */
export type UserCreate = Omit<User, "id" | "createdAt" | "updatedAt" | "lastSeenAt" | "enabled"> & {
  enabled?: boolean;
};

/**
 * Header name used by the public auth middleware to communicate the resolved
 * User to downstream handlers (content gating, API guards, etc.).
 *
 * The middleware serialises the user as JSON into this header after validating
 * the session cookie. Treat as trusted only when set by the same process —
 * a reverse proxy should strip it from inbound external requests.
 *
 * @internal
 */
export const SITE_USER_HEADER = "x-dune-site-user";

/**
 * Extract the User from a request, if one was injected by the public auth
 * middleware. Returns null when the user is unauthenticated or the header is
 * absent or malformed.
 */
export function getSiteUser(req: Request): User | null {
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
      return parsed as User;
    }
    return null;
  } catch {
    return null;
  }
}
