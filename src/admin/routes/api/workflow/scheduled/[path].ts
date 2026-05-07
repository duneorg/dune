/** GET /admin/api/workflow/scheduled/:path */

import type { AdminState } from "../../../../types.ts";
import { requirePermission, json, serverError, validatePagePath } from "../../_utils.ts";
import type { FreshContext } from "fresh";

export const handler = {
  async GET(ctx: FreshContext<AdminState>) {
    const denied = requirePermission(ctx, "pages.read");
    if (denied) return denied;
    const { scheduler } = ctx.state.adminContext;
    if (!scheduler) return json({ error: "Scheduler not enabled" }, 501);
    const pagePath = ctx.params.path;
    if (!validatePagePath(pagePath)) return json({ error: "Invalid path" }, 400);
    try {
      const actions = await scheduler.listForPage(pagePath);
      return json({ items: actions, total: actions.length });
    } catch (err) {
      return serverError(err);
    }
  },
};
