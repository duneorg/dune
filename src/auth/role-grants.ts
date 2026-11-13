/**
 * Which groups hold the admin-tier relations on the site.
 *
 * `admin`, `editor` and `author` are relations in Dune's authz schema (plugins
 * cannot add relations). By default a group of the same name holds each one on
 * the site resource, so a user whose `roles[]` has `editor` is in `group:editor`
 * and may edit. `system.role_grants` lets a site change which group gets which
 * relation: remap its own group (`staff: editor`), keep a subset, or turn the
 * group-level grants off with `{}`.
 *
 * @module
 */

import type { DuneConfig } from "../config/types.ts";

/** A relation of the authz schema that can be granted on the site. */
export type GrantRelation = "admin" | "editor" | "author";

/** Group name → the relation that group holds on the site. */
export type RoleGrants = Record<string, GrantRelation>;

/** The grants a site has when it does not set `system.role_grants`. */
export const DEFAULT_ROLE_GRANTS: Readonly<RoleGrants> = Object.freeze({
  admin: "admin",
  editor: "editor",
  author: "author",
});

/** The relations a group may be granted. */
export const GRANT_RELATIONS: readonly GrantRelation[] = ["admin", "editor", "author"];

/** The site's grants: `system.role_grants` when set (even `{}`), else the defaults. */
export function resolveRoleGrants(config: DuneConfig): RoleGrants {
  const configured = config.system?.role_grants;
  return configured === undefined ? { ...DEFAULT_ROLE_GRANTS } : { ...configured };
}

/** Problems with a `system.role_grants` value, or an empty list. */
export function roleGrantProblems(value: unknown): string[] {
  if (value === undefined) return [];
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return ["must be a mapping of group name to relation (admin, editor or author)"];
  }
  const problems: string[] = [];
  for (const [group, relation] of Object.entries(value)) {
    if (group.trim() === "") problems.push("group names must not be empty");
    if (!GRANT_RELATIONS.includes(relation as GrantRelation)) {
      problems.push(
        `"${group}": ${JSON.stringify(relation)} is not a relation; use admin, editor or author`,
      );
    }
  }
  return problems;
}
