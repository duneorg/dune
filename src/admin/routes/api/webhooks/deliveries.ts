/** GET /admin/api/webhooks/deliveries */

import type { AdminState } from "../../../types.ts";
import { requirePermission, json, serverError } from "../_utils.ts";
import { listDeliveryLogs } from "../../../../admin/webhooks.ts";
import type { FreshContext } from "fresh";

export const handler = {
  async GET(ctx: FreshContext<AdminState>) {
    const denied = requirePermission(ctx, "pages.read");
    if (denied) return denied;
    const { config } = ctx.state.adminContext;
    try {
      const runtimeDir = config.admin?.runtimeDir ?? ".dune/admin";
      const logs = await listDeliveryLogs(runtimeDir);
      return json({ items: logs, total: logs.length });
    } catch (err) {
      return serverError(err);
    }
  },
};
