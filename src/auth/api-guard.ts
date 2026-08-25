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
 * `x-dune-user` request header (JSON) before invoking generated handlers.
 * This is an *internal* header — `createDuneApp()` strips any
 * externally-supplied copy of it from every incoming request unconditionally
 * (regardless of whether `site.auth` is configured), so it can never be
 * forged by a client.
 *
 * Fallback: if the header is absent or malformed, `requireAuth` returns null
 * for "none" mode or a 401 for "required"/"owner" mode.
 */

/** @module */

import type { User } from "./types.ts";
import { getUser, USER_HEADER } from "./types.ts";

/** Name of the internal header used to pass the resolved user. Re-exported from `./types.ts` for convenience. */
export { USER_HEADER };

/**
 * Authentication enforcement mode for generated CRUD route handlers.
 * - `"none"` — public; always passes, user may be null.
 * - `"required"` — any authenticated site user.
 * - `"owner"` — authenticated user whose id matches the record's owner field.
 */
export type AuthMode = "none" | "required" | "owner";

/** Return type of {@link requireAuth} — user on success, error Response on failure. */
export type GuardResult =
  | { error: null; user: User | null }
  | { error: Response; user: null };

/**
 * Extract and validate the site user from a request.
 *
 * Reads the resolved `User` from the internal `x-dune-user` header set by
 * the Dune auth middleware (see {@link getUser} in `./types.ts`). Returns
 * the user (or null for "none" mode) or an error Response that the caller
 * should return immediately.
 *
 * - "none"     — always passes; user may be null.
 * - "required" — returns 401 if no user is present.
 * - "owner"    — returns 401 if no user is present (ownership check is
 *               performed by the caller using the returned user).
 */
export async function requireAuth(
  req: Request,
  mode: AuthMode,
): Promise<GuardResult> {
  const user = getUser(req);

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
 * Ownership check for `mode: "owner"` handlers.
 *
 * {@link requireAuth} with mode `"owner"` only verifies that a user is
 * present — the ownership comparison itself is the handler's responsibility.
 * This helper performs it consistently:
 *
 *   - no user            → 401 (unauthenticated)
 *   - mismatched owner id → 403 (authenticated, not the owner)
 *   - match              → null (caller proceeds)
 *
 * Usage in a generated or hand-written CRUD route:
 *
 * ```ts
 * const denied = ownershipError(getUser(req), record.userId);
 * if (denied) return denied;
 * ```
 *
 * Note: pass the record's stored owner field (`record.userId` by convention,
 * see `api.ownerField` in schema config), never a client-supplied value.
 */
export function ownershipError(
  user: User | null | undefined,
  ownerId: unknown,
): Response | null {
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (typeof ownerId !== "string" || ownerId === "" || user.id !== ownerId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}
