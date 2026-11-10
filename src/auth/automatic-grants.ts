/**
 * Where a site hands out admin-tier roles without anyone being made an editor
 * by hand.
 *
 * `admin`, `editor` and `author` are also ordinary entries of a user's
 * `roles[]`, and holding one carries editing rights (see `bootstrapRoleGrants`).
 * Most sites assign them deliberately (`dune users:create`, the admin panel),
 * but a few configuration paths assign roles by themselves: a payment product's
 * `role`, and the role claims of an external identity provider. Doing that on
 * purpose is legitimate (paid contributors, an IdP that owns staff roles), so
 * nothing here refuses anything. It names the paths so that a site which did not
 * mean it can see it.
 *
 * @module
 */

import type { DuneConfig } from "../config/types.ts";
import { resolveRoleGrants } from "./role-grants.ts";

/** One automatic path to an admin-tier role. */
export interface AutomaticGrant {
  /** `warning` for `admin` (full control), `info` otherwise. */
  severity: "info" | "warning";
  message: string;
}

const CAN: Record<string, string> = {
  admin: "do everything the admin panel allows, including managing users and settings",
  editor: "edit every page and manage media",
  author: "create pages and edit the pages they created",
};

/** The automatic paths to an editing role that `config` sets up. Empty for most sites. */
export function automaticAdminTierGrants(config: DuneConfig): AutomaticGrant[] {
  const out: AutomaticGrant[] = [];
  const site = config.site;
  const grants = resolveRoleGrants(config);

  const payments = site?.payments;
  if (payments?.secret_key) {
    for (const product of payments.products ?? []) {
      const role = product.role;
      const relation = role ? grants[role] : undefined;
      if (role && relation) {
        out.push({
          severity: relation === "admin" ? "warning" : "info",
          message: `payments product "${product.id}" gives every buyer the "${role}" role, which ` +
            `${role === relation ? "is" : `is mapped by system.role_grants to "${relation}" and`} can ${CAN[relation]}. ` +
            `Intended? If "${role}" is only a content tier here, use another role name` +
            `${role === relation ? "" : " or change role_grants"}.`,
        });
      }
    }
  }

  const mapped = Object.entries(grants);
  if (site?.auth?.mode === "external-jwt" && mapped.length > 0) {
    out.push({
      severity: "info",
      message: `the external-jwt login trusts the token's "${site.auth.jwt?.roles_claim ?? "roles"}" claim: a token that ` +
        `carries ${mapped.map(([g, r]) => `"${g}" (${r}: ${CAN[r]})`).join(", ")} grants editing rights. ` +
        `Make sure the identity provider only issues those to staff.`,
    });
  }
  return out;
}
