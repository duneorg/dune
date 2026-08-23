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
 *
 * @module
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
  /**
   * External identity provider this account was originally created with:
   * "local" (password) | "github" | "google" | "discord" | "magic" | ...
   * Unlike `linkedProviders` below, this one is not removable through the
   * account-linking flow — it's the account's original signup method.
   */
  provider: string;
  /** Provider's user ID (for OAuth). */
  providerId?: string;
  /**
   * Additional OAuth identities linked to this account after signup, via
   * `GET /auth/{provider}/link` (requires an existing session). Each entry
   * is independently usable to log in — `getByProvider()` checks both this
   * list and the primary `provider`/`providerId` pair. Unlike the primary
   * pair, entries here can be removed via `POST /auth/{provider}/unlink`.
   *
   * @since 0.32.1
   */
  linkedProviders?: { provider: string; providerId: string }[];
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
export type UserCreate =
  & Omit<User, "id" | "createdAt" | "updatedAt" | "lastSeenAt" | "enabled">
  & {
    enabled?: boolean;
  };

/**
 * Header name used by the public auth middleware to communicate the resolved
 * User to downstream handlers (content gating, API guards, TSX content
 * pages, etc.).
 *
 * The middleware serialises the user as JSON into this header after
 * validating the session cookie. `createDuneApp()` unconditionally strips
 * any externally-supplied copy of this header from every incoming request
 * before any route or plugin sees it, regardless of whether `site.auth` is
 * configured — see `stripUserHeader()` in `src/runtime/server.ts`.
 *
 * @internal
 */
export const USER_HEADER = "x-dune-user";

/**
 * Extract the User from a request, if one was injected by the public auth
 * middleware. Returns null when the user is unauthenticated or the header is
 * absent or malformed.
 */
export function getUser(req: Request): User | null {
  const raw = req.headers.get(USER_HEADER);
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
