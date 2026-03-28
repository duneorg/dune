/**
 * User provisioner — find or create a local AdminUser from external provider attributes.
 *
 * When an external provider (LDAP, SAML, OIDC) authenticates a user, this function
 * maps the provider's user attributes to a local AdminUser record, creating one if it
 * does not exist yet (auto-provisioning). Role and display name are kept in sync with
 * whatever the provider reports on each login.
 *
 * The local user's passwordHash field is set to a random UUID on creation when
 * provisioned from an external provider — the password is never used for external-auth
 * users; authentication always goes through the provider.
 */

import type { AuthProviderUser } from "./provider.ts";
import type { UserManager } from "./users.ts";
import type { AdminUser } from "../types.ts";

/**
 * Find or auto-provision a local AdminUser from external provider attributes.
 *
 * Lookup order:
 *   1. Username match (getByUsername)
 *   2. If not found, create a new user (auto-provision)
 *
 * When an existing user is found and the provider reports a different role or
 * display name, the local record is updated to stay in sync.
 */
export async function findOrProvisionUser(
  providerUser: AuthProviderUser,
  users: UserManager,
): Promise<AdminUser> {
  const existing = await users.getByUsername(providerUser.username);

  if (existing && existing.enabled) {
    // Sync role and name from provider if they have changed
    const roleChanged = providerUser.role !== undefined && existing.role !== providerUser.role;
    const nameChanged = providerUser.name !== undefined && existing.name !== providerUser.name;

    if (roleChanged || nameChanged) {
      const updated = await users.update(existing.id, {
        role: providerUser.role ?? existing.role,
        name: providerUser.name ?? existing.name,
      });
      return updated ?? existing;
    }

    return existing;
  }

  // Auto-provision: create a new user with a random unusable password.
  // The password field is required by CreateUserInput but is never used
  // for external-auth users — authentication always goes through the provider.
  const created = await users.create({
    username: providerUser.username,
    email: providerUser.email ?? `${providerUser.username}@external`,
    password: crypto.randomUUID(),
    role: providerUser.role ?? "author",
    name: providerUser.name ?? providerUser.username,
  });

  return created;
}
