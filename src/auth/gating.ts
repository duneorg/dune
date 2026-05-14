/**
 * Role-based content gating — parse frontmatter `roles` specs and enforce
 * access control for public site content.
 *
 * Frontmatter forms:
 *
 *   roles: member              # single role (user must have this role)
 *   roles: [member, admin]     # OR list — user needs at least one
 *   roles:                     # AND list — user must have all
 *     all: [member, verified]
 *   roles: []                  # authenticated-only (any logged-in user)
 *   # absent                   # public access — no check performed
 */

import type { SiteUser } from "./types.ts";
import { getSiteUser } from "./types.ts";

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * A parsed, typed representation of a page's `roles` frontmatter value.
 *
 * - `string`       — single role required
 * - `string[]`     — any one of these roles satisfies the requirement (OR)
 * - `{ all: string[] }` — every listed role must be present (AND)
 */
export type RolesSpec =
  | string
  | string[]
  | { all: string[] };

// ── Parsing ───────────────────────────────────────────────────────────────────

/**
 * Parse the raw frontmatter `roles` value into a typed `RolesSpec`.
 *
 * Returns `null` when the value is absent or clearly means "public" (so the
 * caller knows no gating check is needed):
 *
 * | Raw value          | Result                          |
 * |--------------------|---------------------------------|
 * | absent / null      | `null` (public)                 |
 * | `"member"`         | `"member"` (single role)        |
 * | `["a", "b"]`       | `["a", "b"]` (OR list)          |
 * | `[]`               | `[]` (authenticated-only)       |
 * | `{ all: ["a"] }`   | `{ all: ["a"] }` (AND list)     |
 * | anything else      | `null` (treated as public)      |
 */
export function parseRolesSpec(raw: unknown): RolesSpec | null {
  // Absent or explicitly null → public
  if (raw === null || raw === undefined) return null;

  // String → single role
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  // Array → OR list (possibly empty = authenticated-only)
  if (Array.isArray(raw)) {
    // Filter to non-empty strings; preserve the array (even empty) since
    // an empty array means "any authenticated user".
    const roles = raw.filter((r): r is string => typeof r === "string" && r.trim().length > 0)
      .map((r) => r.trim());
    // Reconstruct to the cleaned list; original empty arrays stay empty.
    return raw.length === 0 ? [] : roles.length > 0 ? roles : null;
  }

  // Object with `all` key → AND list
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.all)) {
      const all = obj.all
        .filter((r): r is string => typeof r === "string" && r.trim().length > 0)
        .map((r: string) => r.trim());
      return all.length > 0 ? { all } : null;
    }
  }

  // Unknown shape → public (safe default)
  return null;
}

// ── Checking ──────────────────────────────────────────────────────────────────

/**
 * Determine whether a `SiteUser` satisfies a `RolesSpec`.
 *
 * - `null` user → always denied (regardless of spec)
 * - `string` spec → user must have that exact role
 * - `string[]` spec → user must have at least one (OR); empty array = any user
 * - `{ all: string[] }` spec → user must have every listed role (AND)
 */
export function checkRoles(user: SiteUser | null, spec: RolesSpec): boolean {
  // Unauthenticated visitors can never satisfy a gating spec.
  if (user === null) return false;

  if (typeof spec === "string") {
    return user.roles.includes(spec);
  }

  if (Array.isArray(spec)) {
    // Empty array → any authenticated user
    if (spec.length === 0) return true;
    // OR: user has at least one of the listed roles
    return spec.some((r) => user.roles.includes(r));
  }

  // AND: user must have every role in the list
  return spec.all.every((r) => user.roles.includes(r));
}

// ── Enforcement ───────────────────────────────────────────────────────────────

/**
 * Enforce a roles spec for a request.
 *
 * Returns `null` when access is granted.
 * Returns a `Response` when access is denied:
 *   - Unauthenticated user with a spec present → 302 to `/auth/login?next=<url>`
 *   - Authenticated user with insufficient roles → 403 plain text
 *
 * Callers should return the `Response` immediately when it is non-null.
 */
export function enforceRoles(
  req: Request,
  user: SiteUser | null,
  spec: RolesSpec,
): Response | null {
  if (checkRoles(user, spec)) {
    return null; // access granted
  }

  if (user === null) {
    // Redirect unauthenticated visitors to the login page with a return URL.
    const url = new URL(req.url);
    const next = encodeURIComponent(url.pathname + url.search);
    return new Response(null, {
      status: 302,
      headers: { Location: `/auth/login?next=${next}` },
    });
  }

  // Authenticated but lacks required roles → 403
  return new Response("Forbidden", {
    status: 403,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

/**
 * Convenience: read the SiteUser from the request and enforce a roles spec in
 * one call.
 *
 * Returns `null` when access is granted, or a Response to return to the client.
 */
export function enforceRolesFromRequest(
  req: Request,
  spec: RolesSpec,
): Response | null {
  const user = getSiteUser(req);
  return enforceRoles(req, user, spec);
}
