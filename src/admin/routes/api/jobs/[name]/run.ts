/** POST /admin/api/jobs/:name/run — manually trigger a job */

import type { AdminState } from "../../../../types.ts";
import { json, requirePermission, csrfCheck } from "../../_utils.ts";
import type { FreshContext } from "fresh";

export const handler = {
  async POST(ctx: FreshContext<AdminState>) {
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;
    const denied = await requirePermission(ctx, "config.update");
    if (denied) return denied;

    const { jobScheduler } = ctx.state.adminContext as typeof ctx.state.adminContext & {
      jobScheduler?: import("../../../../../jobs/mod.ts").JobScheduler;
    };

    if (!jobScheduler) {
      return json({ error: "No jobs registered" }, 404);
    }

    const { name } = ctx.params;
    try {
      // Run asynchronously — don't block the HTTP response waiting for completion
      jobScheduler.run(name).catch((err) => {
        console.error(`[dune/jobs] Manual run of ${name} failed:`, err);
      });
      return json({ triggered: true, name });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return json({ error: msg }, 404);
    }
  },
};
