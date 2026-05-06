/** GET /admin/api/search/analytics */

import type { AdminState } from "../../../types.ts";
import { requirePermission, json, serverError } from "../_utils.ts";
import { createSearchAnalytics } from "../../../../search/analytics.ts";
import { join } from "@std/path";
import type { FreshContext } from "fresh";

export const handler = {
  async GET(ctx: FreshContext<AdminState>) {
    const denied = requirePermission(ctx, "pages.read");
    if (denied) return denied;
    const { config } = ctx.state.adminContext;
    try {
      const runtimeDir = config.admin?.runtimeDir ?? ".dune/admin";
      const analyticsPath = join(runtimeDir, "search-analytics.jsonl");
      const summary = await createSearchAnalytics(analyticsPath).summarize();
      return json(summary);
    } catch (err) {
      return serverError(err);
    }
  },
};
