/** GET /admin/api/plugins */

import type { AdminState } from "../../../types.ts";
import { json } from "../_utils.ts";
import type { FreshContext } from "fresh";
import type { DunePlugin } from "../../../../hooks/types.ts";

export const handler = {
  GET(ctx: FreshContext<AdminState>) {
    const { hooks, config } = ctx.state.adminContext;
    const plugins = hooks?.plugins() ?? [];
    return json({
      items: plugins.map((p: DunePlugin) => ({
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
