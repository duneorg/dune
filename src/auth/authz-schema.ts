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
 * ## Granular admin permissions (mirror of ROLE_PERMISSIONS)
 *   authz.check({ who: adminUser, canThey: "pages.create", onWhat: { type: "app", id: "admin" } })
 *
 * The admin permission actions below are the canonical permission definition.
 * ROLE_PERMISSIONS in src/admin/types.ts is kept for reference only and must
 * stay in sync with this schema.
 */

import { defineSchema } from "polizy";

export const duneAuthzSchema = defineSchema({
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
    /** General access (read/view). Satisfied by any role. */
    access: ["member", "admin", "editor", "author", "owner"],
    /** Write/edit access on a specific resource */
    edit: ["owner", "admin", "editor"],

    // ── Admin panel — granular permissions (maps 1:1 with AdminPermission) ─
    //
    // These mirror ROLE_PERMISSIONS in src/admin/types.ts. Change one → change both.
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

export type DuneAuthzSchema = typeof duneAuthzSchema;
