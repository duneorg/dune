/** GET /admin/api/config */


import type { AdminState } from "../../../types.ts";
import { requirePermission, json } from "../_utils.ts";
import { getAdminContext } from "../../../context.ts";
import type { FreshContext } from "fresh";

export const handler = {
  GET(ctx: FreshContext<AdminState>) {
    const denied = requirePermission(ctx, "config.read");
    if (denied) return denied;
    const { engine } = getAdminContext();
    const { title, description, url: siteUrl, author, metadata, taxonomies } = engine.site;
    return json({ title, description, url: siteUrl, author, metadata, taxonomies });
  },
};
