/** GET + PUT + DELETE /admin/api/flex/:type/:id */

import type { AdminState } from "../../../../../types.ts";
import { json, serverError, csrfCheck } from "../../../_utils.ts";
import type { FreshContext } from "fresh";

export const handler = {
  async GET(ctx: FreshContext<AdminState>) {
    const { flex } = ctx.state.adminContext;
    if (!flex) return json({ error: "Flex Objects not enabled" }, 501);
    const type = decodeURIComponent(ctx.params.type);
    const id = decodeURIComponent(ctx.params.id);
    const schemas = await flex.loadSchemas();
    if (!schemas[type]) return json({ error: "Unknown type" }, 404);
    const record = await flex.get(type, id);
    if (!record) return json({ error: "Record not found" }, 404);
    return json(record);
  },

  async PUT(ctx: FreshContext<AdminState>) {
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;
    const { flex } = ctx.state.adminContext;
    if (!flex) return json({ error: "Flex Objects not enabled" }, 501);
    const type = decodeURIComponent(ctx.params.type);
    const id = decodeURIComponent(ctx.params.id);
    const schemas = await flex.loadSchemas();
    const schema = schemas[type];
    if (!schema) return json({ error: "Unknown type" }, 404);
    try {
      const body = await ctx.req.json() as Record<string, unknown>;
      const record = await flex.update(type, id, schema, body);
      if (!record) return json({ error: "Record not found" }, 404);
      return json({ record });
    } catch (err) {
      if (Array.isArray(err)) return json({ error: "Validation failed", validationErrors: err }, 422);
      return serverError(err);
    }
  },

  async DELETE(ctx: FreshContext<AdminState>) {
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;
    const { flex } = ctx.state.adminContext;
    if (!flex) return json({ error: "Flex Objects not enabled" }, 501);
    const type = decodeURIComponent(ctx.params.type);
    const id = decodeURIComponent(ctx.params.id);
    const schemas = await flex.loadSchemas();
    if (!schemas[type]) return json({ error: "Unknown type" }, 404);
    await flex.delete(type, id);
    return json({ deleted: true });
  },
};
