/** GET /admin/api/workflow/stages */


import type { AdminState } from "../../../types.ts";
import { json } from "../_utils.ts";
import { getAdminContext } from "../../../context.ts";
import type { FreshContext } from "fresh";

export const handler = {
  GET(_ctx: FreshContext<AdminState>) {
    const { workflow } = getAdminContext();
    if (!workflow) return json({ stages: [], defaultStatus: "draft" });
    return json({ stages: workflow.stages, defaultStatus: workflow.stages[0]?.id ?? "draft" });
  },
};
