/**
 * LDAP authentication provider.
 *
 * ## Status: STUB — not yet implemented
 *
 * This class compiles and satisfies the AuthProvider interface but `authenticate()`
 * throws a NotImplemented error. To implement LDAP authentication, replace the body of
 * `authenticate()` with a proper LDAP bind flow using an LDAP client library.
 *
 * ## Suggested implementation using ldapts (npm:ldapts):
 *
 * ```typescript
 * import { Client } from "npm:ldapts";
 *
 * async authenticate(creds: AuthCredentials): Promise<AuthProviderUser | null> {
 *   const usernameAttr = this.config.usernameAttr ?? "uid";
 *   const emailAttr = this.config.emailAttr ?? "mail";
 *   const nameAttr = this.config.nameAttr ?? "cn";
 *   const client = new Client({ url: this.config.url });
 *   try {
 *     if (this.config.bindDn) {
 *       // Service account bind, then search for the user entry
 *       const bindPw = expandEnv(this.config.bindPassword ?? "");
 *       await client.bind(this.config.bindDn, bindPw);
 *       const { searchEntries } = await client.search(this.config.baseDn, {
 *         filter: `(${usernameAttr}=${creds.username})`,
 *         attributes: ["dn", emailAttr, nameAttr, "memberOf"],
 *       });
 *       if (!searchEntries.length) return null;
 *       const entry = searchEntries[0];
 *       // Rebind as the located user to verify their password
 *       await client.bind(entry.dn as string, creds.password);
 *       const role = mapRole(entry["memberOf"] as string | string[] | undefined, this.config.roleMap)
 *         ?? this.config.defaultRole
 *         ?? "author";
 *       return {
 *         externalId: entry.dn as string,
 *         username: creds.username,
 *         email: entry[emailAttr] as string | undefined,
 *         name: entry[nameAttr] as string | undefined,
 *         role,
 *       };
 *     } else {
 *       // Direct bind: construct user DN from template
 *       const userDn = `${usernameAttr}=${creds.username},${this.config.baseDn}`;
 *       await client.bind(userDn, creds.password);
 *       return {
 *         externalId: userDn,
 *         username: creds.username,
 *         role: this.config.defaultRole ?? "author",
 *       };
 *     }
 *   } catch {
 *     return null; // Bind failure = bad credentials
 *   } finally {
 *     await client.unbind();
 *   }
 * }
 *
 * // Expand "$ENV_VAR" references in config values
 * function expandEnv(value: string): string {
 *   return value.replace(/^\$([A-Z_][A-Z0-9_]*)$/, (_, name) => Deno.env.get(name) ?? "");
 * }
 *
 * // Map LDAP group membership to a Dune role (first match wins)
 * function mapRole(
 *   memberOf: string | string[] | undefined,
 *   roleMap: Array<{ group: string; role: AdminRole }> | undefined,
 * ): AdminRole | undefined {
 *   if (!roleMap || !memberOf) return undefined;
 *   const groups = Array.isArray(memberOf) ? memberOf : [memberOf];
 *   for (const { group, role } of roleMap) {
 *     if (groups.includes(group)) return role;
 *   }
 *   return undefined;
 * }
 * ```
 *
 * ## Required deno.json import map entry:
 * ```json
 * { "npm:ldapts": "npm:ldapts@^4" }
 * ```
 */

import type { AuthProvider, AuthCredentials, AuthProviderUser, LdapProviderConfig } from "./provider.ts";

export class LdapAuthProvider implements AuthProvider {
  readonly type = "ldap" as const;

  constructor(private config: LdapProviderConfig) {}

  async authenticate(_creds: AuthCredentials): Promise<AuthProviderUser | null> {
    throw new Error(
      "LdapAuthProvider is a stub — see src/admin/auth/ldap-provider.ts for the implementation guide",
    );
  }
}
