/**
 * Dune's default authorization schema for polizy.
 *
 * Covers all authorization layers uniformly:
 *   - Content gating (`roles:` frontmatter) — "access" on object type "group"
 *   - Admin panel access + granular admin permissions — actions on object type "app"
 *   - Inline editing — "edit" on object type "resource"
 *   - Resource-level grants — "owner" relation on object type "resource"
 *
 * Subject types: "user"
 * Object types:  "group" | "app" | "resource"
 *
 * ## Content gating
 *   `roles: member` → authz.check({ who: user, canThey: "access", onWhat: { type: "group", id: "member" } })
 *   authz.addMember({ member: { type: "user", id }, group: { type: "group", id: "member" } })
 *
 * ## Admin panel access (top-level)
 *   authz.check({ who: adminUser, canThey: "access", onWhat: { type: "app", id: "admin" } })
 *
 * ## Granular admin permissions
 *   authz.check({ who: adminUser, canThey: "pages.create", onWhat: { type: "app", id: "admin" } })
 *
 * The admin permission actions below are the sole, canonical permission
 * definition — `@dune/plugin-admin` no longer keeps its own `ROLE_PERMISSIONS`
 * mirror (removed alongside dec-identity-unification Phase 5c/6, 3.0.0); see
 * {@link roleHasPermission} for the one place that still needs a synchronous
 * read of this same data instead of `authz.check()`.
 */

import { defineSchema } from "polizy";
import type { AuthSchema } from "polizy";

/**
 * The polizy authorization schema for Dune — defines relations and action-to-relation mappings
 * for content gating, admin access, and resource ownership.
 */
// deno-lint-ignore no-explicit-any
export const duneAuthzSchema: AuthSchema<any, any, any, any, any> = defineSchema({
  relations: {
    /** Group membership — used for role-based content gating. The `type: "group"` marker
     *  tells polizy that `addMember()` should use this relation. */
    member: { type: "group" },
    /** Admin-level direct access to an app or resource */
    admin: { type: "direct" },
    /** Editor-level access */
    editor: { type: "direct" },
    /** Author-level access */
    author: { type: "direct" },
    /** Resource ownership (per-object grant) */
    owner: { type: "direct" },
  },
  actionToRelations: {
    // ── Site-user actions ──────────────────────────────────────────────────
    /** General access (read/view). Satisfied by group membership or admin-tier roles.
     *
     *  `owner` is intentionally excluded: it is a per-resource direct grant used for
     *  inline editing (`edit` action). Including it here would allow a user who owns
     *  a specific resource (e.g. a page) to pass *group-based* content gating checks
     *  — a confused-deputy that grants unintended access to gated content.
     *
     *  If an owner should also be able to access gated content, grant them the
     *  appropriate group membership (e.g. `authz.addMember(...)`) explicitly.
     */
    access: ["member", "admin", "editor", "author"],
    /** Write/edit access on a specific resource */
    edit: ["owner", "admin", "editor"],

    // ── Admin panel — granular permissions (maps 1:1 with AdminPermission) ─
    //
    // Sole definition — nothing else mirrors this (see the module doc above).
    //
    "pages.create": ["admin", "editor", "author"],
    "pages.read":   ["admin", "editor", "author"],
    "pages.update": ["admin", "editor", "author"],
    "pages.delete": ["admin"],
    "media.upload": ["admin", "editor", "author"],
    "media.read":   ["admin", "editor", "author"],
    "media.delete": ["admin", "editor"],
    "users.create": ["admin"],
    "users.read":   ["admin"],
    "users.update": ["admin"],
    "users.delete": ["admin"],
    "config.read":   ["admin", "editor"],
    "config.update": ["admin"],
    "submissions.read":   ["admin", "editor", "author"],
    "submissions.delete": ["admin"],

    // ── Legacy convenience actions (kept for backward compat) ──────────────
    /** User management (broader than users.update — covers create/delete too). */
    "users.manage": ["admin"],
  },
  subjectTypes: ["user"] as const,
  objectTypes: ["group", "app", "resource"] as const,
});

/** TypeScript type of the Dune authorization schema — pass to `AuthSystem` generics. */
export type DuneAuthzSchema = typeof duneAuthzSchema;

/**
 * Synchronous, role-only approximation of an admin permission check, sourced
 * directly from this schema's `actionToRelations` — the single canonical
 * permission definition, not a hand-maintained mirror of it.
 *
 * `authz.check()` is the real, async, sole authority for every admin route.
 * This exists only for the one place in Dune that cannot call it: a
 * published, synchronous hook API (`ResponseTransformContext.auth
 * .hasPermission()`, `src/cli/response-transforms.ts`) that plugin authors
 * already depend on. It answers exactly for the permission that gated the
 * hook context into existing in the first place, and is a reasonable
 * approximation for any other permission a plugin might ask about — the
 * same tradeoff a flat role table always made, just without a second table
 * to keep in sync with this one.
 *
 * ⚠️ **Not for access decisions.** This is an *approximation*: it sees only
 * the role vocabulary in `actionToRelations` and knows nothing of what
 * `authz.check()` knows beyond roles — revoked tuples, per-user direct
 * grants (`owner`/`editor` relations), or group membership. Its answer can
 * therefore diverge from the sole authority in either direction. Do NOT use
 * it (or copy it) to gate access anywhere — use `authz.check()`. If you
 * need a permission decision in a synchronous context, restructure the
 * context so the decision is made once, asynchronously, and passed in.
 */
export function roleHasPermission(role: string, permission: string): boolean {
  const relations = duneAuthzSchema.actionToRelations as Record<string, readonly string[]>;
  return relations[permission]?.includes(role) ?? false;
}

/**
 * Pick the highest-ranked admin-tier role (`"admin" > "editor" > "author"`)
 * out of a generic `roles: string[]` array, or `""` if none is present.
 *
 * A merged `User`'s `roles[]` mixes admin-tier roles with content-gating
 * tags (e.g. `["member", "admin"]`) in no guaranteed order, so `roles[0]`
 * is not necessarily an admin role at all. Permission answers sourced from
 * a single `role` string must use the highest admin-tier entry — matching
 * what `authz.check()` (which unions all the user's relations) would
 * decide — or the synchronous approximation under-privileges relative to
 * the sole authority. Used for `ResponseTransformContext.auth.role` /
 * `.hasPermission()`, the one place that can't call the real async check.
 */
export function highestAdminRole(roles: string[] | undefined): string {
  const rank: Record<string, number> = { admin: 3, editor: 2, author: 1 };
  let best = "";
  for (const r of roles ?? []) {
    const rr = rank[r] ?? 0;
    if (rr === 0) continue; // unknown / content-gating tag — never wins
    if (!best || rr > (rank[best] ?? 0)) best = r;
  }
  return best;
}
