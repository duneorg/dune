/** GET /admin/api/workflow/status/:path */

import type { AdminState } from "../../../../types.ts";
import { requirePermission, json } from "../../_utils.ts";
import type { FreshContext } from "fresh";

export const handler = {
  GET(ctx: FreshContext<AdminState>) {
    const denied = requirePermission(ctx, "pages.read");
    if (denied) return denied;
    const { workflow, engine } = ctx.state.adminContext;
    if (!workflow) return json({ error: "Workflow not enabled" }, 501);

    const pagePath = ctx.params.path;
    const pageIndex = engine.pages.find((p) => p.sourcePath === pagePath);
    if (!pageIndex) return json({ error: "Page not found" }, 404);

    const status = workflow.getStatus(pageIndex);
    const userRole = ctx.state.auth.user?.role;
    const transitionObjects = workflow.allowedTransitionObjects(status, userRole);

    return json({
      sourcePath: pagePath,
      status,
      allowedTransitions: transitionObjects.map((t) => t.to),
      transitions: transitionObjects.map((t) => ({ to: t.to, label: t.label ?? t.to })),
      stages: workflow.stages,
    });
  },
};
