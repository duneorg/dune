/**
 * Dune's default authorization schema for polizy.
 *
 * Covers all authorization layers uniformly:
 *   - Content gating (`roles:` frontmatter)
 *   - Admin panel access (future migration from ROLE_PERMISSIONS)
 *   - Inline editing
 *   - Resource-level grants
 *
 * Subject types: "user"
 * Object types:  "group" | "app" | "resource"
 *
 * Content gating pattern:
 *   `roles: member` → authz.check({ who: user, canThey: "access", onWhat: { type: "group", id: "member" } })
 *
 * Granting group membership (e.g. after payment):
 *   authz.addMember({ member: { type: "user", id }, group: { type: "group", id: "member" } })
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
    /** General access (read/view). Satisfied by any role. */
    access: ["member", "admin", "editor", "author", "owner"],
    /** Write/edit access */
    edit: ["owner", "admin", "editor"],
    /** Create or update pages */
    "pages.update": ["admin", "editor"],
    /** User management */
    "users.manage": ["admin"],
    /** Media upload */
    "media.upload": ["admin", "editor", "author"],
  },
  subjectTypes: ["user"] as const,
  objectTypes: ["group", "app", "resource"] as const,
});

export type DuneAuthzSchema = typeof duneAuthzSchema;
