/** GET /admin/api/workflow/scheduled/:path */


import type { AdminState } from "../../../../types.ts";
import { requirePermission, json, serverError } from "../../_utils.ts";
import { getAdminContext } from "../../../../context.ts";
import type { FreshContext } from "fresh";

export const handler = {
  async GET(ctx: FreshContext<AdminState>) {
    const denied = requirePermission(ctx, "pages.read");
    if (denied) return denied;
    const { scheduler } = getAdminContext();
    if (!scheduler) return json({ error: "Scheduler not enabled" }, 501);
    try {
      const actions = await scheduler.listForPage(ctx.params.path);
      return json({ items: actions, total: actions.length });
    } catch (err) {
      return serverError(err);
    }
  },
};
