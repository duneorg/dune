/** POST /admin/api/i18n/translate-segment */


import type { AdminState } from "../../../types.ts";
import { json, serverError, csrfCheck } from "../_utils.ts";
import { getAdminContext } from "../../../context.ts";
import type { FreshContext } from "fresh";

export const handler = {
  async POST(ctx: FreshContext<AdminState>) {
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;

    const { mt } = getAdminContext();
    if (!mt) return json({ error: "Machine translation not configured" }, 501);

    try {
      const body = await ctx.req.json();
      const { text, from, to } = body;
      if (!text || typeof text !== "string" || !from || typeof from !== "string" || !to || typeof to !== "string") {
        return json({ error: "text, from, and to are required" }, 400);
      }
      let translation: string;
      try {
        translation = await mt.translate(text, from, to);
      } catch (err) {
        return json({ error: `Translation failed: ${err}` }, 502);
      }
      return json({ ok: true, translation });
    } catch (err) {
      return serverError(err);
    }
  },
};
