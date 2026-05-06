/** POST /admin/api/workflow/schedule */


import type { AdminState } from "../../../../types.ts";
import { requirePermission, json, serverError, csrfCheck } from "../../_utils.ts";
import { getAdminContext } from "../../../../context.ts";
import type { FreshContext } from "fresh";

export const handler = {
  async POST(ctx: FreshContext<AdminState>) {
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;
    const denied = requirePermission(ctx, "pages.update");
    if (denied) return denied;

    const { scheduler } = getAdminContext();
    if (!scheduler) return json({ error: "Scheduler not enabled" }, 501);

    const authResult = ctx.state.auth;
    try {
      const body = await ctx.req.json();
      const { sourcePath, action, scheduledAt } = body;
      if (!sourcePath || !action || !scheduledAt) {
        return json({ error: "sourcePath, action, and scheduledAt are required" }, 400);
      }
      const scheduled = await scheduler.schedule({
        sourcePath, action, scheduledAt,
        createdBy: authResult.user?.username,
      });
      return json({ scheduled: true, action: scheduled }, 201);
    } catch (err) {
      return serverError(err);
    }
  },
};
