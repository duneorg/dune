/** POST /admin/api/editor/serialize — Blocks → Markdown */


import type { AdminState } from "../../../types.ts";
import { json, serverError } from "../_utils.ts";
import { blocksToMarkdown } from "../../../../admin/editor/serializer.ts";
import type { FreshContext } from "fresh";

export const handler = {
  async POST(ctx: FreshContext<AdminState>) {
    try {
      const body = await ctx.req.json();
      const { blocks } = body;
      if (!Array.isArray(blocks)) return json({ error: "blocks array required" }, 400);
      return json({ markdown: blocksToMarkdown(blocks) });
    } catch (err) {
      return serverError(err);
    }
  },
};
