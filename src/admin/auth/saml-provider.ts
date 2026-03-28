/**
 * SAML 2.0 authentication provider.
 *
 * ## Status: STUB — not yet implemented
 *
 * `authenticate()` is not applicable for SAML (no direct credential flow).
 * SAML uses `initiateLogin()` to start the SP-initiated SSO redirect and
 * `handleCallback()` to process the IdP's POST response to the ACS endpoint.
 *
 * ## Suggested implementation using samlify (npm:samlify):
 *
 * ```typescript
 * import * as saml from "npm:samlify";
 *
 * // Build SP + IdP instances (ideally cached at construction time)
 * private buildSp() {
 *   return saml.ServiceProvider({
 *     entityID: this.config.entityId,
 *     assertionConsumerService: [
 *       { Binding: saml.Constants.namespace.binding.post, Location: this.config.acsUrl },
 *     ],
 *   });
 * }
 *
 * private buildIdp() {
 *   return saml.IdentityProvider({ metadata: this.config.idpMetadata });
 * }
 *
 * async initiateLogin(_req: Request): Promise<string | null> {
 *   const sp = this.buildSp();
 *   const idp = this.buildIdp();
 *   const { context } = sp.createLoginRequest(idp, "redirect");
 *   return context; // redirect URL with SAMLRequest query param
 * }
 *
 * async handleCallback(req: Request): Promise<AuthProviderUser | null> {
 *   const body = await req.formData();
 *   const samlResponse = body.get("SAMLResponse") as string | null;
 *   if (!samlResponse) return null;
 *
 *   const sp = this.buildSp();
 *   const idp = this.buildIdp();
 *   try {
 *     const { extract } = await sp.parseLoginResponse(idp, "post", {
 *       body: { SAMLResponse: samlResponse },
 *     });
 *     const nameId: string = extract.nameID;
 *     const attrs = extract.attributes ?? {};
 *     const usernameAttr = this.config.usernameAttr ?? "NameID";
 *     const emailAttr = this.config.emailAttr ?? "email";
 *     const nameAttr = this.config.nameAttr ?? "displayName";
 *     const roleAttr = this.config.roleAttr ?? "role";
 *     const role = mapRole(attrs[roleAttr], this.config.roleMap)
 *       ?? this.config.defaultRole
 *       ?? "author";
 *     return {
 *       externalId: nameId,
 *       username: (attrs[usernameAttr] as string) ?? nameId,
 *       email: attrs[emailAttr] as string | undefined,
 *       name: attrs[nameAttr] as string | undefined,
 *       role,
 *     };
 *   } catch {
 *     return null; // Signature verification or parsing failure
 *   }
 * }
 *
 * function mapRole(
 *   value: string | string[] | undefined,
 *   roleMap: Array<{ value: string; role: AdminRole }> | undefined,
 * ): AdminRole | undefined {
 *   if (!roleMap || value === undefined) return undefined;
 *   const values = Array.isArray(value) ? value : [value];
 *   for (const { value: v, role } of roleMap) {
 *     if (values.includes(v)) return role;
 *   }
 *   return undefined;
 * }
 * ```
 *
 * ## Required deno.json import map entry:
 * ```json
 * { "npm:samlify": "npm:samlify@^2" }
 * ```
 *
 * ## Required route registration in server.ts:
 * Register a POST /admin/saml/acs route that calls `provider.handleCallback(req)`
 * and then calls `findOrProvisionUser()` followed by the session creation flow.
 */

import type { AuthProvider, AuthCredentials, AuthProviderUser, SamlProviderConfig } from "./provider.ts";

export class SamlAuthProvider implements AuthProvider {
  readonly type = "saml" as const;

  constructor(private config: SamlProviderConfig) {}

  async authenticate(_creds: AuthCredentials): Promise<AuthProviderUser | null> {
    throw new Error(
      "SamlAuthProvider uses initiateLogin()/handleCallback() — direct credential authentication is not supported for SAML",
    );
  }

  async initiateLogin(_req: Request): Promise<string | null> {
    throw new Error(
      "SamlAuthProvider is a stub — see src/admin/auth/saml-provider.ts for the implementation guide",
    );
  }

  async handleCallback(_req: Request): Promise<AuthProviderUser | null> {
    throw new Error(
      "SamlAuthProvider is a stub — see src/admin/auth/saml-provider.ts for the implementation guide",
    );
  }
}
