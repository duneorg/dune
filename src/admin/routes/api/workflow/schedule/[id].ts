/** DELETE /admin/api/workflow/schedule/:id */


import type { AdminState } from "../../../../types.ts";
import { requirePermission, json, serverError, csrfCheck } from "../../_utils.ts";
import { getAdminContext } from "../../../../context.ts";
import type { FreshContext } from "fresh";

export const handler = {
  async DELETE(ctx: FreshContext<AdminState>) {
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;
    const denied = requirePermission(ctx, "pages.update");
    if (denied) return denied;
    const { scheduler } = getAdminContext();
    if (!scheduler) return json({ error: "Scheduler not enabled" }, 501);
    try {
      const cancelled = await scheduler.cancel(ctx.params.id);
      return json({ cancelled });
    } catch (err) {
      return serverError(err);
    }
  },
};
