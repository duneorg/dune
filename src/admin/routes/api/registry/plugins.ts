/** GET /admin/api/registry/plugins */


import type { AdminState } from "../../../types.ts";
import { requirePermission, json } from "../_utils.ts";
import type { FreshContext } from "fresh";

export const handler = {
  async GET(ctx: FreshContext<AdminState>) {
    const denied = requirePermission(ctx, "config.read");
    if (denied) return denied;
    try {
      const registryUrl = new URL("../../registry/plugins.json", import.meta.url);
      const registry = JSON.parse(await Deno.readTextFile(registryUrl));
      return json(registry);
    } catch {
      return json({ version: 1, plugins: [] });
    }
  },
};
