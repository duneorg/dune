/** GET /admin/api/jobs — list all registered jobs with their current state */

import type { AdminState } from "../../types.ts";
import { json, requirePermission } from "./_utils.ts";
import type { FreshContext } from "fresh";

export const handler = {
  async GET(ctx: FreshContext<AdminState>) {
    const denied = await requirePermission(ctx, "config.read");
    if (denied) return denied;

    const { jobScheduler } = ctx.state.adminContext as typeof ctx.state.adminContext & {
      jobScheduler?: import("../../../jobs/mod.ts").JobScheduler;
    };

    if (!jobScheduler) {
      return json({ jobs: [], message: "No jobs registered" });
    }

    const jobs = await jobScheduler.listStatus();
    return json({ jobs });
  },
};
