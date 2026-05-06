/** GET + POST /admin/api/flex/:type */

import type { AdminState } from "../../../../types.ts";
import { json, serverError, csrfCheck } from "../../_utils.ts";
import type { FreshContext } from "fresh";

export const handler = {
  async GET(ctx: FreshContext<AdminState>) {
    const { flex } = ctx.state.adminContext;
    if (!flex) return json({ error: "Flex Objects not enabled" }, 501);
    const type = decodeURIComponent(ctx.params.type);
    const schemas = await flex.loadSchemas();
    if (!schemas[type]) return json({ error: "Unknown type" }, 404);
    const records = await flex.list(type);
    return json({ items: records, total: records.length });
  },

  async POST(ctx: FreshContext<AdminState>) {
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;
    const { flex } = ctx.state.adminContext;
    if (!flex) return json({ error: "Flex Objects not enabled" }, 501);
    const type = decodeURIComponent(ctx.params.type);
    const schemas = await flex.loadSchemas();
    const schema = schemas[type];
    if (!schema) return json({ error: "Unknown type" }, 404);
    try {
      const body = await ctx.req.json() as Record<string, unknown>;
      const record = await flex.create(type, schema, body);
      return json({ record }, 201);
    } catch (err) {
      if (Array.isArray(err)) return json({ error: "Validation failed", validationErrors: err }, 422);
      return serverError(err);
    }
  },
};
