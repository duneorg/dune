/** GET /admin/api/plugins */


import type { AdminState } from "../../../types.ts";
import { json } from "../_utils.ts";
import { getAdminContext } from "../../../context.ts";
import type { FreshContext } from "fresh";

export const handler = {
  GET(_ctx: FreshContext<AdminState>) {
    const { hooks, config } = getAdminContext();
    const plugins = hooks?.plugins() ?? [];
    return json({
      items: plugins.map((p) => ({
        name: p.name,
        version: p.version,
        description: p.description,
        author: p.author,
        hooks: Object.keys(p.hooks),
        hasConfigSchema: !!(p.configSchema && Object.keys(p.configSchema).length > 0),
        config: config.plugins[p.name] ?? {},
      })),
      total: plugins.length,
    });
  },
};
