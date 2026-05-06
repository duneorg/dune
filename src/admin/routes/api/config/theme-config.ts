/** GET + PUT /admin/api/config/theme-config */

import type { AdminState } from "../../../types.ts";
import { requirePermission, json, serverError, csrfCheck } from "../_utils.ts";
import type { BlueprintField } from "../../../../blueprints/types.ts";
import type { FreshContext } from "fresh";

export const handler = {
  GET(ctx: FreshContext<AdminState>) {
    const denied = requirePermission(ctx, "config.read");
    if (denied) return denied;
    const { engine } = ctx.state.adminContext;
    const manifest = engine.themes.theme.manifest;
    return json({
      themeName: engine.config.theme.name,
      schema: manifest.configSchema ?? {},
      config: engine.themeConfig,
    });
  },

  async PUT(ctx: FreshContext<AdminState>) {
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;
    const denied = requirePermission(ctx, "config.update");
    if (denied) return denied;

    const { engine, storage, config } = ctx.state.adminContext;
    try {
      const body = await ctx.req.json() as Record<string, unknown>;
      const manifest = engine.themes.theme.manifest;
      const schema = manifest.configSchema;

      if (schema && typeof schema === "object" && !Array.isArray(schema)) {
        const schemaRecord = schema as Record<string, BlueprintField>;
        const errors: string[] = [];
        for (const [key, field] of Object.entries(schemaRecord)) {
          if (field.type === "number" && body[key] !== undefined && body[key] !== null) {
            const n = Number(body[key]);
            body[key] = isNaN(n) ? body[key] : n;
          } else if (field.type === "toggle") {
            body[key] = body[key] === true || body[key] === "true";
          }
          if (field.required && (body[key] === undefined || body[key] === null || body[key] === "")) {
            errors.push(field.label ?? key);
          }
        }
        if (errors.length > 0) return json({ error: `Missing required fields: ${errors.join(", ")}` }, 422);
      }

      const dataDir = config.admin?.dataDir ?? "data";
      const themeConfigPath = `${dataDir}/theme-config.json`;
      await storage.write(themeConfigPath, new TextEncoder().encode(JSON.stringify(body, null, 2)));

      Object.assign(engine.themeConfig, body);
      for (const key of Object.keys(engine.themeConfig)) {
        if (!(key in body)) delete engine.themeConfig[key];
      }

      return json({ saved: true });
    } catch (err) {
      return serverError(err);
    }
  },
};
