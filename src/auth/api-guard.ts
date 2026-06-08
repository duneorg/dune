/**
 * API guard helper for generated CRUD route handlers.
 *
 * Generated route files (produced by `dune codegen`) import this module as
 * `jsr:@dune/core/auth/api-guard` and call `requireAuth` at the top of each
 * handler.
 *
 * How it receives the user
 * ─────────────────────────
 * The Fresh middleware registered by `mountDuneAuth` sets `fc.state.siteUser`.
 * Generated route handlers receive a plain `Request` object (not a Fresh
 * FreshContext), so they cannot read Fresh state directly.
 *
 * Instead, the internal middleware also serialises the resolved user into the
 * `X-Dune-Site-User` request header (JSON) before invoking generated handlers.
 * This is an *internal* header — it is stripped at the edge and never exposed
 * to external callers.
 *
 * Fallback: if the header is absent or malformed, `requireAuth` returns null
 * for "none" mode or a 401 for "required"/"owner" mode.
 */

/** @module */

import type { SiteUser } from "./types.ts";

/** Name of the internal header used to pass the resolved site user. */
export const SITE_USER_HEADER = "x-dune-site-user";

/**
 * Authentication enforcement mode for generated CRUD route handlers.
 * - `"none"` — public; always passes, user may be null.
 * - `"required"` — any authenticated site user.
 * - `"owner"` — authenticated user whose id matches the record's owner field.
 */
export type AuthMode = "none" | "required" | "owner";

/** Return type of {@link requireAuth} — user on success, error Response on failure. */
export type GuardResult =
  | { error: null; user: SiteUser | null }
  | { error: Response; user: null };

/**
 * Extract and validate the site user from a request.
 *
 * Reads the resolved `SiteUser` from the internal `x-dune-site-user` header
 * set by the Dune auth middleware. Returns the user (or null for "none" mode)
 * or an error Response that the caller should return immediately.
 *
 * - "none"     — always passes; user may be null.
 * - "required" — returns 401 if no user is present.
 * - "owner"    — returns 401 if no user is present (ownership check is
 *               performed by the caller using the returned user).
 */
export async function requireAuth(req: Request, mode: AuthMode): Promise<GuardResult> {
  const user = resolveUserFromHeader(req);

  if (mode === "none") {
    return { error: null, user };
  }

  // Both "required" and "owner" need a valid user
  if (!user) {
    return {
      error: Response.json({ error: "Unauthorized" }, { status: 401 }),
      user: null,
    };
  }

  return { error: null, user };
}

/**
 * Deserialise the site user from the internal `x-dune-site-user` header.
 * Returns null if the header is absent, empty, or cannot be parsed.
 */
function resolveUserFromHeader(req: Request): SiteUser | null {
  const raw = req.headers.get(SITE_USER_HEADER);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    // Minimal sanity-check: must have an id string
    if (parsed && typeof parsed === "object" && typeof parsed.id === "string") {
      return parsed as SiteUser;
    }
    return null;
  } catch {
    return null;
  }
}
