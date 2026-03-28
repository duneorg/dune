/**
 * AuthProvider interface — abstracts identity verification from session management.
 *
 * Providers handle step 1+2 of the login flow (verify identity, return user attributes).
 * The session/cookie/user-provisioning layer in server.ts is shared across all providers.
 */

import type { AdminRole } from "../types.ts";

/** User attributes returned by an external auth provider after successful authentication. */
export interface AuthProviderUser {
  /** Stable external identifier (LDAP DN, SAML NameID, OpenID sub, local user ID, etc.) */
  externalId: string;
  /** Login name */
  username: string;
  email?: string;
  name?: string;
  /** Role to assign when auto-provisioning this user. Default: "author" */
  role?: AdminRole;
}

/** Credentials passed to an AuthProvider for direct username+password flows (local, LDAP). */
export interface AuthCredentials {
  username: string;
  password: string;
}

/**
 * An authentication provider handles identity verification.
 * Multiple provider types are supported; the session and user-provisioning layer is shared.
 *
 * Username+password flows (local, LDAP) use `authenticate()`.
 * Redirect-based flows (SAML, OIDC) use `initiateLogin()` + `handleCallback()`.
 */
export interface AuthProvider {
  readonly type: "local" | "ldap" | "saml" | "oidc";

  /**
   * Verify credentials and return provider user attributes.
   * Returns null on authentication failure (wrong password, user not found, bind error, etc.).
   * Used for local and LDAP username+password flows.
   */
  authenticate(credentials: AuthCredentials): Promise<AuthProviderUser | null>;

  /**
   * Initiate login for redirect-based providers (SAML, OIDC).
   * Returns a URL to redirect the browser to, or null if not applicable to this provider type.
   */
  initiateLogin?(req: Request): Promise<string | null>;

  /**
   * Handle a callback from an external provider (SAML ACS endpoint, OIDC redirect URI).
   * Returns authenticated user attributes or null on failure.
   */
  handleCallback?(req: Request): Promise<AuthProviderUser | null>;
}

/** Configuration union for all supported provider types. */
export type AuthProviderConfig =
  | { type: "local" }
  | LdapProviderConfig
  | SamlProviderConfig;

/** LDAP authentication provider configuration. */
export interface LdapProviderConfig {
  type: "ldap";
  /**
   * LDAP server URL.
   * @example "ldap://ldap.example.com:389"
   * @example "ldaps://ldap.example.com:636"
   */
  url: string;
  /**
   * Base DN for user search.
   * @example "ou=users,dc=example,dc=com"
   */
  baseDn: string;
  /**
   * LDAP attribute containing the login name.
   * Default: "sAMAccountName" (Active Directory) or "uid" (OpenLDAP).
   */
  usernameAttr?: string;
  /**
   * Optional bind DN for a service account used to search the directory.
   * If omitted, Dune attempts a direct bind using the user's constructed DN.
   */
  bindDn?: string;
  /**
   * Service account password. Supports "$ENV_VAR" expansion.
   * @example "$LDAP_BIND_PASSWORD"
   */
  bindPassword?: string;
  /** LDAP attribute to use as email. Default: "mail" */
  emailAttr?: string;
  /** LDAP attribute to use as display name. Default: "cn" */
  nameAttr?: string;
  /**
   * Map LDAP group membership to Dune roles. First match wins.
   * @example
   * ```yaml
   * roleMap:
   *   - group: "cn=cms-admins,ou=groups,dc=example,dc=com"
   *     role: "admin"
   *   - group: "cn=cms-editors,ou=groups,dc=example,dc=com"
   *     role: "editor"
   * ```
   */
  roleMap?: Array<{ group: string; role: AdminRole }>;
  /** Default role for authenticated users not in any mapped group. Default: "author" */
  defaultRole?: AdminRole;
}

/** SAML 2.0 authentication provider configuration. */
export interface SamlProviderConfig {
  type: "saml";
  /** Your application's Entity ID (SP entity ID). */
  entityId: string;
  /**
   * Assertion Consumer Service URL — where the IdP POSTs the assertion after authentication.
   * @example "https://example.com/admin/saml/acs"
   */
  acsUrl: string;
  /** Identity provider metadata as a URL (fetched at startup) or inline XML. */
  idpMetadata: string;
  /** SAML attribute containing the username. Default: "NameID" */
  usernameAttr?: string;
  /** SAML attribute containing the email. Default: "email" or "mail" */
  emailAttr?: string;
  /** SAML attribute containing the display name. Default: "displayName" */
  nameAttr?: string;
  /**
   * Map IdP group/role attribute values to Dune roles. First match wins.
   */
  roleMap?: Array<{ value: string; role: AdminRole }>;
  /** SAML attribute carrying the role or group value. Default: "role" or "groups" */
  roleAttr?: string;
  /** Default role for users with no matching roleMap entry. Default: "author" */
  defaultRole?: AdminRole;
}
