/** PUT /admin/api/plugins/:name/config */

import type { AdminState } from "../../../../types.ts";
import { requirePermission, json, serverError, csrfCheck } from "../../_utils.ts";
import type { BlueprintField } from "../../../../../blueprints/types.ts";
import type { FreshContext } from "fresh";

export const handler = {
  async PUT(ctx: FreshContext<AdminState>) {
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;
    const denied = requirePermission(ctx, "config.update");
    if (denied) return denied;

    const { hooks, storage, config } = ctx.state.adminContext;
    const pluginName = decodeURIComponent(ctx.params.name);
    if (!pluginName) return json({ error: "Plugin name required" }, 400);

    const plugin = hooks?.plugins().find((p) => p.name === pluginName);
    if (!plugin) return json({ error: "Plugin not found" }, 404);

    try {
      const body = await ctx.req.json() as Record<string, unknown>;
      const configSchema = plugin.configSchema;

      if (configSchema && typeof configSchema === "object" && !Array.isArray(configSchema)) {
        const schema = configSchema as Record<string, BlueprintField>;
        const errors: string[] = [];
        for (const [key, field] of Object.entries(schema)) {
          const val = body[key];
          if (field.type === "number" && val !== undefined && val !== null) {
            const n = Number(val);
            body[key] = isNaN(n) ? val : n;
          } else if (field.type === "toggle") {
            body[key] = val === true || val === "true";
          }
          const coerced = body[key];
          if (field.required && (coerced === undefined || coerced === null || coerced === "")) {
            errors.push(field.label ?? key);
          }
        }
        if (errors.length > 0) return json({ error: `Missing required fields: ${errors.join(", ")}` }, 422);
      }

      const dataDir = config.admin?.dataDir ?? "data";
      const filePath = `${dataDir}/plugins/${pluginName}.json`;
      await storage.write(filePath, new TextEncoder().encode(JSON.stringify(body, null, 2)));

      config.plugins[pluginName] = { ...(config.plugins[pluginName] ?? {}), ...body };
      return json({ saved: true });
    } catch (err) {
      return serverError(err);
    }
  },
};
