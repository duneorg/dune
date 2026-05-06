/** POST /admin/api/workflow/transition */

import type { AdminState } from "../../../types.ts";
import { requirePermission, json, serverError, csrfCheck } from "../_utils.ts";
import { fireContentWebhooks } from "../../../../admin/webhooks.ts";
import type { FreshContext } from "fresh";

export const handler = {
  async POST(ctx: FreshContext<AdminState>) {
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;
    const denied = requirePermission(ctx, "pages.update");
    if (denied) return denied;

    const { workflow, engine, storage, config, hooks } = ctx.state.adminContext;
    if (!workflow) return json({ error: "Workflow not enabled" }, 501);

    const authResult = ctx.state.auth;
    try {
      const body = await ctx.req.json();
      const { sourcePath, status: newStatus } = body;
      if (!sourcePath || !newStatus) return json({ error: "sourcePath and status are required" }, 400);

      const pageIndex = engine.pages.find((p) => p.sourcePath === sourcePath);
      if (!pageIndex) return json({ error: "Page not found" }, 404);

      const currentStatus = workflow.getStatus(pageIndex);
      const userRole = authResult.user?.role;
      if (!workflow.canTransition(currentStatus, newStatus, userRole)) {
        return json({ error: `Cannot transition from ${currentStatus} to ${newStatus}` }, 400);
      }

      const contentDir = config.system.content.dir;
      const filePath = `${contentDir}/${pageIndex.sourcePath}`;
      const raw = new TextDecoder().decode(await storage.read(filePath));

      let updated = raw.match(/^status:\s*.+$/m)
        ? raw.replace(/^status:\s*.+$/m, `status: ${newStatus}`)
        : raw.replace(/^---\n/, `---\nstatus: ${newStatus}\n`);

      if (workflow.setsPublished(newStatus)) {
        if (updated.match(/^published:\s*.+$/m)) {
          updated = updated.replace(/^published:\s*.+$/m, "published: true");
        }
      } else {
        if (updated.match(/^published:\s*.+$/m)) {
          updated = updated.replace(/^published:\s*.+$/m, "published: false");
        }
      }

      await storage.write(filePath, new TextEncoder().encode(updated));
      await engine.rebuild();

      const webhookEndpoints = config.admin?.webhooks ?? [];
      const runtimeDir = config.admin?.runtimeDir ?? ".dune/admin";
      if (hooks) hooks.fire("onWorkflowChange", { sourcePath, from: currentStatus, to: newStatus }).catch(() => {});
      fireContentWebhooks(webhookEndpoints, "onWorkflowChange", { sourcePath, from: currentStatus, to: newStatus }, runtimeDir);

      return json({ transitioned: true, from: currentStatus, to: newStatus });
    } catch (err) {
      return serverError(err);
    }
  },
};
