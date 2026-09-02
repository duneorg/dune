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
 * The admin permission actions below are the sole, canonical *built-in*
 * permission definition — `@dune/plugin-admin` no longer keeps its own
 * `ROLE_PERMISSIONS` mirror (removed alongside dec-identity-unification
 * Phase 5c/6, 3.0.0); see {@link roleHasPermission} for the one place that
 * still needs a synchronous read of this same data instead of
 * `authz.check()`. A plugin can extend this vocabulary with its own actions
 * via `DunePlugin.authzActions` — see {@link buildDuneAuthzSchema}.
 */

import { defineSchema } from "polizy";
import type { AuthSchema } from "polizy";
import type { Role } from "../config/admin-config.ts";

/**
 * A polizy relation name a plugin-contributed action can require. Limited
 * to Dune's existing built-in relations (no plugin can define a *new*
 * relation type today — see `buildDuneAuthzSchema`'s doc comment for why).
 */
export type AuthzRelation = "member" | "admin" | "editor" | "author" | "owner";

/**
 * Dune's built-in actions, mapped to the relations that satisfy each —
 * `@dune/plugin-admin`'s canonical permission definition (see the module
 * doc above). Exported (not just inlined into {@link buildDuneAuthzSchema})
 * so bootstrap can detect a plugin trying to redeclare one of these names
 * before merging in plugin-contributed actions.
 */
export const DUNE_BASE_AUTHZ_ACTIONS = {
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
  // Sole built-in definition — nothing else mirrors this (see the module doc above).
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
} as const satisfies Record<string, readonly AuthzRelation[]>;

/**
 * Build Dune's polizy authorization schema — the built-in actions above,
 * plus any actions plugins have contributed via `DunePlugin.authzActions`.
 *
 * `defineSchema()` itself is pure, synchronous, and just validates that
 * every action's relations actually exist on the schema — there's no
 * architectural reason a plugin can't extend the action vocabulary, only
 * that `duneAuthzSchema` used to be a module-level constant built once at
 * import time, before any plugin had registered. This function replaces
 * that: `bootstrap()` calls it once per site, after every plugin's
 * `setup()` has run and their `authzActions` have been collected and
 * de-duplicated against both the built-ins and each other (a name
 * collision is dropped with a logged warning, not silently merged —
 * see `bootstrap.ts`).
 *
 * Deliberately relation-only, not a way to define new *relation* types: a
 * plugin action can require `admin`/`editor`/`author`/`owner`/`member` (the
 * existing structural vocabulary polizy's tuple model already understands),
 * but can't invent its own relation kind. Covers the actual motivating case
 * (gate a new admin capability the same correct way every built-in route
 * is) without opening the larger, harder question of arbitrary
 * plugin-defined relation semantics.
 *
 * @param pluginActions Already-merged, already-collision-checked plugin
 *   actions (`bootstrap.ts` builds this) — pass nothing for the plain
 *   built-in schema (tests, headless usage with no plugins contributing
 *   actions).
 */
export function buildDuneAuthzSchema(
  pluginActions?: Record<string, readonly AuthzRelation[]>,
  // deno-lint-ignore no-explicit-any
): AuthSchema<any, any, any, any, any> {
  return defineSchema({
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
      ...DUNE_BASE_AUTHZ_ACTIONS,
      ...pluginActions,
    },
    subjectTypes: ["user"] as const,
    objectTypes: ["group", "app", "resource"] as const,
  });
}

/**
 * The plain built-in schema, no plugin-contributed actions — for any
 * caller that isn't a per-site bootstrap (tests, standalone/headless
 * usage, or anything that predates plugin-extensible actions and just
 * wants the same default as always). A real site's actual schema (with
 * whatever its plugins contributed) lives on `BootstrapResult.authzSchema`
 * instead — read from there when you have a `BootstrapResult` in hand.
 */
// deno-lint-ignore no-explicit-any
export const duneAuthzSchema: AuthSchema<any, any, any, any, any> = buildDuneAuthzSchema();

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
 *
 * @param actionToRelations The schema's action-to-relations map to check
 *   against — pass a site's actual `BootstrapResult.authzSchema
 *   .actionToRelations` so a plugin-contributed action resolves correctly;
 *   defaults to just the built-ins (`DUNE_BASE_AUTHZ_ACTIONS`) for callers
 *   with no per-site schema in hand.
 */
export function roleHasPermission(
  role: string,
  permission: string,
  actionToRelations: Record<string, readonly string[]> = DUNE_BASE_AUTHZ_ACTIONS,
): boolean {
  return actionToRelations[permission]?.includes(role) ?? false;
}

/**
 * Canonical admin-tier role ranking (`"admin" > "editor" > "author"`) —
 * the single source of truth `highestAdminRole()` below uses, and the one
 * `@dune/plugin-admin`'s `role-utils.ts` imports for its own direct rank
 * comparisons (`provisioner.ts`'s role-escalation guards) instead of
 * keeping a second, hand-maintained copy of the same three numbers. This
 * is the exact "two tables that must be kept in sync by convention"
 * pattern the `ROLE_PERMISSIONS` removal (3.0.0) was about eliminating —
 * codified once, here, rather than repeated.
 */
export const ADMIN_ROLE_RANK: Record<Role, number> = {
  admin: 3,
  editor: 2,
  author: 1,
};

/**
 * Pick the highest-ranked admin-tier role out of a generic `roles: string[]`
 * array, or `""` if none is present.
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
  let best = "";
  for (const r of roles ?? []) {
    const rr = ADMIN_ROLE_RANK[r as Role] ?? 0;
    if (rr === 0) continue; // unknown / content-gating tag — never wins
    if (!best || rr > (ADMIN_ROLE_RANK[best as Role] ?? 0)) best = r;
  }
  return best;
}
