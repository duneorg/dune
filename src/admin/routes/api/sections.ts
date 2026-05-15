/** GET /admin/api/sections */


import type { AdminState } from "../../types.ts";
import { requirePermission, json } from "./_utils.ts";
import { sectionRegistry } from "../../../sections/mod.ts";
import type { FreshContext } from "fresh";

export const handler = {
  async GET(ctx: FreshContext<AdminState>) {
    const denied = await requirePermission(ctx, "pages.read");
    if (denied) return denied;
    return json(sectionRegistry.all());
  },
};
