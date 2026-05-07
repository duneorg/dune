/**
 * User provisioner — find or create a local AdminUser from external provider attributes.
 *
 * When an external provider (LDAP, SAML, OIDC) authenticates a user, this function
 * maps the provider's user attributes to a local AdminUser record, creating one if it
 * does not exist yet (auto-provisioning). Display name is kept in sync with whatever
 * the provider reports on each login.
 *
 * Role policy (security):
 *   - The provisioner refuses to escalate an existing user's role from external
 *     attributes. A buggy or compromised IdP that suddenly reports role:"admin"
 *     for an existing "author" account does NOT elevate them.
 *   - New users are provisioned at the configured `defaultRole` (or "author" if
 *     the provider has none configured), and the provider-reported role is only
 *     accepted if it's a valid AdminRole. Any unknown role string is rejected.
 *   - Role *demotion* is permitted (admin -> editor, editor -> author) so an
 *     IdP can revoke privileges, but never elevate them. Operators that need
 *     to grant admin must do so locally.
 *
 * The local user's passwordHash field is set to a random UUID on creation when
 * provisioned from an external provider — the password is never used for external-auth
 * users; authentication always goes through the provider.
 */

import type { AuthProviderUser } from "./provider.ts";
import type { UserManager } from "./users.ts";
import type { AdminRole, AdminUser } from "../types.ts";

const VALID_ROLES: ReadonlySet<AdminRole> = new Set<AdminRole>([
  "admin", "editor", "author",
]);
const ROLE_RANK: Record<AdminRole, number> = { admin: 3, editor: 2, author: 1 };

function sanitizeProviderRole(role: string | undefined, fallback: AdminRole): AdminRole {
  if (typeof role !== "string") return fallback;
  if (!VALID_ROLES.has(role as AdminRole)) return fallback;
  return role as AdminRole;
}

/**
 * Find or auto-provision a local AdminUser from external provider attributes.
 *
 * Lookup order:
 *   1. Username match (getByUsername)
 *   2. If not found, create a new user (auto-provision)
 *
 * When an existing user is found and the provider reports a *demoted* role,
 * the local record is updated. Role escalation is refused.
 */
export async function findOrProvisionUser(
  providerUser: AuthProviderUser,
  users: UserManager,
  options: { defaultRole?: AdminRole } = {},
): Promise<AdminUser> {
  const defaultRole: AdminRole = options.defaultRole ?? "author";
  const existing = await users.getByUsername(providerUser.username);

  if (existing && existing.enabled) {
    const proposedRole = sanitizeProviderRole(providerUser.role, existing.role);
    // Refuse to elevate from external attributes: only allow if the proposed
    // role is at the same rank or lower than the existing role.
    const safeRole = ROLE_RANK[proposedRole] <= ROLE_RANK[existing.role]
      ? proposedRole
      : existing.role;

    const roleChanged = safeRole !== existing.role;
    const nameChanged = providerUser.name !== undefined && existing.name !== providerUser.name;

    if (roleChanged || nameChanged) {
      const updated = await users.update(existing.id, {
        role: safeRole,
        name: providerUser.name ?? existing.name,
      });
      return updated ?? existing;
    }

    return existing;
  }

  // Auto-provision: create a new user with a random unusable password and a
  // role limited to the configured default. Provider-reported roles are
  // accepted at provisioning time only if they're valid AdminRole strings.
  // Even then we cap new users at defaultRole (so a misconfigured provider
  // can't auto-create an admin user on first login).
  const requestedRole = sanitizeProviderRole(providerUser.role, defaultRole);
  const newRole = ROLE_RANK[requestedRole] <= ROLE_RANK[defaultRole]
    ? requestedRole
    : defaultRole;

  const created = await users.create({
    username: providerUser.username,
    email: providerUser.email ?? `${providerUser.username}@external`,
    password: crypto.randomUUID(),
    role: newRole,
    name: providerUser.name ?? providerUser.username,
  });

  return created;
}
