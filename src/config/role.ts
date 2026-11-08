/**
 * The admin-tier role vocabulary.
 *
 * @module
 */

/**
 * User role — inlined here so that config does not depend on the admin
 * plugin package. Bare name (no "Admin" prefix) per
 * decisions/dec-identity-unification.md's Phase 3: role/identity concepts
 * aren't admin-panel-specific, even though this type currently only gates
 * admin-panel access — @dune/plugin-admin's role field uses this same type.
 */
export type Role = "admin" | "editor" | "author";
