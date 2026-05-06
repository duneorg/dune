/** GET /admin/api/metrics */


import type { AdminState } from "../../types.ts";
import { json } from "./_utils.ts";
import { getAdminContext } from "../../context.ts";
import type { FreshContext } from "fresh";

export const handler = {
  GET(ctx: FreshContext<AdminState>) {
    const { metrics } = getAdminContext();
    if (ctx.state.auth.user?.role !== "admin") {
      return json({ error: "Forbidden" }, 403);
    }
    if (!metrics) return json({ error: "Metrics not enabled" }, 404);
    return json(metrics.snapshot());
  },
};
