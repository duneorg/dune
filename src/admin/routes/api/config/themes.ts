/** GET /admin/api/config/themes */


import type { AdminState } from "../../../types.ts";
import { requirePermission, json, serverError } from "../_utils.ts";
import { getAdminContext } from "../../../context.ts";
import type { FreshContext } from "fresh";

export const handler = {
  async GET(ctx: FreshContext<AdminState>) {
    const denied = requirePermission(ctx, "config.read");
    if (denied) return denied;
    const { engine } = getAdminContext();
    try {
      const themes = await engine.getAvailableThemes();
      return json({ themes, current: engine.config.theme.name });
    } catch (err) {
      return serverError(err);
    }
  },
};
