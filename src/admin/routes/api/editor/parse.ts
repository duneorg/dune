/** POST /admin/api/editor/parse — Markdown → Blocks */


import type { AdminState } from "../../../types.ts";
import { json, serverError, csrfCheck, requirePermission } from "../_utils.ts";
import { markdownToBlocks } from "../../../../admin/editor/serializer.ts";
import type { FreshContext } from "fresh";

export const handler = {
  async POST(ctx: FreshContext<AdminState>) {
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;
    const denied = requirePermission(ctx, "pages.read");
    if (denied) return denied;
    try {
      const body = await ctx.req.json();
      const { content } = body;
      if (typeof content !== "string") return json({ error: "content string required" }, 400);
      return json(markdownToBlocks(content));
    } catch (err) {
      return serverError(err);
    }
  },
};
