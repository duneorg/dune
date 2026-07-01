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
 *
 * When a polizy AuthSystem is wired via `setGatingAuthz()`, role checks go
 * through `authz.check()` for full hierarchy and group membership support.
 * Without an authz instance the fallback direct `user.roles[]` array check
 * is used — same semantics, no polizy dependency.
 */

import type { SiteUser } from "./types.ts";
import { getSiteUser } from "./types.ts";
import type { DuneAuthSystem } from "./authz.ts";

// ── Per-origin authz registry ──────────────────────────────────────────────────

/**
 * Map of site origin → DuneAuthSystem.
 *
 * In multisite deployments each mounted site calls `setGatingAuthz(origin, authz)`.
 * `checkRolesAsync` / `enforceRolesFromRequest` select the instance by origin so
 * that each site uses its own permission store.
 *
 * Single-site deployments register exactly one entry. When `enforceRolesFromRequest`
 * is called it will find the single registered origin and use it as the fallback
 * regardless of the incoming request origin — keeping single-site behaviour unchanged.
 */
const _authzByOrigin = new Map<string, DuneAuthSystem>();

/**
 * Wire a polizy AuthSystem into the gating layer for a specific site origin.
 *
 * Call this from `mountDuneAuth()` after constructing the AuthSystem. The origin
 * argument should be `new URL(config.site.url).origin`.
 *
 * Pass `null` as `authz` to remove the registration for that origin (reverts to
 * the simple array-check fallback for requests to that origin).
 *
 * Single-site deployments call this once; multisite deployments call it once per
 * site with their respective origins.
 */
export function setGatingAuthz(authz: DuneAuthSystem | null, origin?: string): void {
  const key = origin ?? "_default";
  if (authz === null) {
    _authzByOrigin.delete(key);
  } else {
    _authzByOrigin.set(key, authz);
  }
}

/**
 * Resolve the authz instance for a given request origin.
 *
 * Selection logic:
 * 1. If the origin is registered, return that instance.
 * 2. If only one origin is registered (single-site), return it regardless of origin.
 * 3. Otherwise return null (fall back to direct array check).
 */
function resolveAuthzForOrigin(requestOrigin: string | null): DuneAuthSystem | null {
  if (requestOrigin !== null && _authzByOrigin.has(requestOrigin)) {
    return _authzByOrigin.get(requestOrigin)!;
  }
  // Single-site fallback: if exactly one instance is registered, use it.
  if (_authzByOrigin.size === 1) {
    return _authzByOrigin.values().next().value as DuneAuthSystem;
  }
  return null;
}

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
 * Sync fallback role check against the user's `roles[]` array.
 *
 * Used directly by tests and as a fallback when no authz instance is
 * configured. Does not support group hierarchy or inheritance.
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

/**
 * Async role check — goes through polizy `authz.check()` when an AuthSystem
 * is configured, otherwise falls back to `checkRoles()`.
 *
 * Using authz.check() enables group hierarchy, inheritance, and any custom
 * relation logic defined in the schema.
 *
 * @param authzOverride - Optional per-site AuthSystem. Pass the site-specific
 *   `authz` instance to bypass the per-origin registry lookup.
 */
export async function checkRolesAsync(
  user: SiteUser | null,
  spec: RolesSpec,
  authzOverride?: DuneAuthSystem | null,
): Promise<boolean> {
  if (user === null) return false;

  // Empty array spec → any authenticated user, no authz lookup needed
  if (Array.isArray(spec) && spec.length === 0) return true;

  // Use the per-call override when provided; otherwise use the registered singleton
  // (single-site deployments will have exactly one entry).
  const effectiveAuthz = authzOverride !== undefined
    ? authzOverride
    : (_authzByOrigin.size === 1 ? _authzByOrigin.values().next().value as DuneAuthSystem : null);

  if (effectiveAuthz === null) {
    // No authz configured — fall back to direct array check
    return checkRoles(user, spec);
  }

  const subject = { type: "user" as const, id: user.id };

  if (typeof spec === "string") {
    // Single role: check if user can "access" the named group
    return effectiveAuthz.check({
      who: subject,
      canThey: "access",
      onWhat: { type: "group", id: spec },
    });
  }

  if (Array.isArray(spec)) {
    // OR: user must be able to access at least one of the listed groups
    for (const role of spec) {
      const ok = await effectiveAuthz.check({
        who: subject,
        canThey: "access",
        onWhat: { type: "group", id: role },
      });
      if (ok) return true;
    }
    return false;
  }

  // AND: user must be able to access every listed group
  for (const role of spec.all) {
    const ok = await effectiveAuthz.check({
      who: subject,
      canThey: "access",
      onWhat: { type: "group", id: role },
    });
    if (!ok) return false;
  }
  return true;
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
 * Uses `authz.check()` when a polizy AuthSystem is configured (wired via
 * `setGatingAuthz()`), otherwise falls back to the direct array check.
 *
 * @param authzOverride - Optional per-site AuthSystem to bypass registry lookup.
 *
 * Callers should return the `Response` immediately when it is non-null.
 */
export async function enforceRoles(
  req: Request,
  user: SiteUser | null,
  spec: RolesSpec,
  authzOverride?: DuneAuthSystem | null,
): Promise<Response | null> {
  const granted = await checkRolesAsync(user, spec, authzOverride);
  if (granted) return null;

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
 * one call. Selects the authz instance by request origin from the per-origin map.
 *
 * Returns `null` when access is granted, or a Response to return to the client.
 *
 * @param authzOverride - Optional per-site AuthSystem to bypass registry lookup.
 */
export async function enforceRolesFromRequest(
  req: Request,
  spec: RolesSpec,
  authzOverride?: DuneAuthSystem | null,
): Promise<Response | null> {
  const user = getSiteUser(req);
  // Resolve authz by origin so each site in a multisite deployment uses its own
  // permission store. Single-site deployments are unaffected: the single
  // registered entry is used as a fallback when the origin is not in the map.
  const origin = (() => { try { return new URL(req.url).origin; } catch { return null; } })();
  const effectiveAuthz = authzOverride !== undefined
    ? authzOverride
    : resolveAuthzForOrigin(origin);
  return enforceRoles(req, user, spec, effectiveAuthz);
}
