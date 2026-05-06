/** POST /admin/api/editor/parse — Markdown → Blocks */


import type { AdminState } from "../../../types.ts";
import { json, serverError } from "../_utils.ts";
import { markdownToBlocks } from "../../../../admin/editor/serializer.ts";
import type { FreshContext } from "fresh";

export const handler = {
  async POST(ctx: FreshContext<AdminState>) {
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
