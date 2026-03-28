---
title: "Authentication Providers"
published: true
visible: true
taxonomy:
  audience: [webmaster, developer]
  difficulty: [advanced]
  topic: [administration, security, authentication]
metadata:
  description: "Plug in LDAP, SAML, or other identity providers for admin panel authentication"
---

# Authentication Providers

By default, Dune manages admin users with local password accounts (PBKDF2-SHA256). For organizations that already have a central directory service, you can delegate authentication to an external provider.

The `AuthProvider` interface abstracts the identity verification step. Once a provider confirms who the user is, Dune's session management and permission system take over — all existing roles, revision history, and audit logging work unchanged.

---

## Default: local accounts

No configuration needed. Users are managed in Admin → Users.

```yaml
# site.yaml — this is the implicit default
admin:
  # auth_provider: not set → local passwords
```

---

## LDAP / Active Directory

> **Status: stub** — the interface and configuration schema are stable. The `ldapts` integration is documented below and can be activated by implementing `src/admin/auth/ldap-provider.ts`.

Configure in `site.yaml`:

```yaml
admin:
  auth_provider:
    type: "ldap"
    url: "ldaps://ldap.example.com:636"
    baseDn: "ou=users,dc=example,dc=com"

    # Service account for search (optional — omit for direct bind)
    bindDn: "cn=dune-service,dc=example,dc=com"
    bindPassword: "$LDAP_BIND_PASSWORD"

    # Attribute names (defaults shown)
    usernameAttr: "sAMAccountName"   # Active Directory; use "uid" for OpenLDAP
    emailAttr: "mail"
    nameAttr: "cn"

    # Group → role mapping (first match wins)
    roleMap:
      - group: "cn=cms-admins,ou=groups,dc=example,dc=com"
        role: "admin"
      - group: "cn=cms-editors,ou=groups,dc=example,dc=com"
        role: "editor"

    defaultRole: "author"   # Role for users not in any mapped group
```

### How it works

1. User enters username + password in the admin login form
2. Dune's `LdapAuthProvider` binds to the LDAP server as a service account and searches for the user DN
3. A second bind with the user's DN and submitted password verifies the credentials
4. Group memberships are read and mapped to a Dune role via `roleMap`
5. The first time a user logs in, a local `AdminUser` record is auto-provisioned (no password set — only LDAP auth is used thereafter)
6. A session cookie is issued and the user lands on the dashboard

### Auto-provisioning

Users authenticated via LDAP get a local `AdminUser` record created automatically on first login. The record stores role and display name (synced from LDAP on every login). You can still see and edit these users in Admin → Users, but their passwords are not used.

---

## SAML 2.0

> **Status: stub** — the interface and configuration schema are stable. The `samlify` integration is documented below and can be activated by implementing `src/admin/auth/saml-provider.ts`.

Configure in `site.yaml`:

```yaml
admin:
  auth_provider:
    type: "saml"

    # Your SP (Service Provider) settings
    entityId: "https://example.com/admin"
    acsUrl: "https://example.com/admin/saml/acs"   # POST /admin/saml/acs

    # IdP metadata (URL or inline XML)
    idpMetadata: "https://idp.example.com/metadata.xml"

    # Attribute mapping (defaults shown)
    usernameAttr: "username"
    emailAttr: "email"
    nameAttr: "displayName"
    roleAttr: "groups"

    # Group value → role mapping
    roleMap:
      - value: "cms-admins"
        role: "admin"
      - value: "cms-editors"
        role: "editor"

    defaultRole: "author"
```

### Login flow

1. User visits `/admin/login` and clicks "Sign in with SSO"
2. Dune's `SamlAuthProvider.initiateLogin()` constructs an AuthnRequest and redirects to the IdP
3. After authentication, the IdP POSTs a signed SAML assertion to `POST /admin/saml/acs`
4. `handleCallback()` parses the assertion, extracts attributes, maps to a Dune role
5. The user is auto-provisioned (if new) and a session is created

---

## Building a custom provider

Implement the `AuthProvider` interface from `src/admin/auth/provider.ts`:

```typescript
import type { AuthProvider, AuthCredentials, AuthProviderUser } from "./provider.ts";

export class MyAuthProvider implements AuthProvider {
  readonly type = "local" as const;  // use "local" for non-stub custom providers

  async authenticate(creds: AuthCredentials): Promise<AuthProviderUser | null> {
    // Verify credentials against your system
    // Return null on failure, AuthProviderUser on success
    const user = await myIdentityService.verify(creds.username, creds.password);
    if (!user) return null;
    return {
      externalId: user.id,
      username: user.username,
      email: user.email,
      name: user.displayName,
      role: "editor",
    };
  }
}
```

Then wire it up in your `bootstrap.ts`:

```typescript
import { MyAuthProvider } from "./my-auth-provider.ts";
// Pass to createAdminHandler({ ..., authProvider: new MyAuthProvider() })
```

### `AuthProviderUser` fields

| Field | Type | Description |
|-------|------|-------------|
| `externalId` | `string` | Stable external ID (LDAP DN, SAML NameID, etc.) |
| `username` | `string` | Login name — used to find/create the local user |
| `email` | `string?` | Used in the local user record |
| `name` | `string?` | Display name |
| `role` | `AdminRole?` | Override the local user's role on each login |

---

## Configuration reference

```yaml
admin:
  auth_provider:
    type: "local" | "ldap" | "saml"
    # ... provider-specific fields as documented above
```

If `auth_provider` is not set, local password authentication is used and `admin.auth_provider` has no effect.
