/** GET /admin/api/workflow/stages */

import type { AdminState } from "../../../types.ts";
import { json } from "../_utils.ts";
import type { FreshContext } from "fresh";

export const handler = {
  GET(ctx: FreshContext<AdminState>) {
    const { workflow } = ctx.state.adminContext;
    if (!workflow) return json({ stages: [], defaultStatus: "draft" });
    return json({ stages: workflow.stages, defaultStatus: workflow.stages[0]?.id ?? "draft" });
  },
};
