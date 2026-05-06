/** PUT /admin/api/config/theme */


import type { AdminState } from "../../../types.ts";
import { requirePermission, json, serverError, csrfCheck } from "../_utils.ts";
import { getAdminContext } from "../../../context.ts";
import type { FreshContext } from "fresh";

export const handler = {
  async PUT(ctx: FreshContext<AdminState>) {
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;
    const denied = requirePermission(ctx, "config.update");
    if (denied) return denied;

    const { engine } = getAdminContext();
    try {
      const body = await ctx.req.json() as { name?: string };
      if (!body.name || typeof body.name !== "string") {
        return json({ error: "Theme name required" }, 400);
      }
      const available = await engine.getAvailableThemes();
      if (!available.includes(body.name)) {
        return json({ error: `Theme "${body.name}" not found` }, 404);
      }
      await engine.switchTheme(body.name);
      return json({ switched: true, theme: body.name });
    } catch (err) {
      return serverError(err);
    }
  },
};
