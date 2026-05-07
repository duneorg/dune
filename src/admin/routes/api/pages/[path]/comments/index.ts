/** GET + POST /admin/api/pages/:path/comments */

import type { AdminState } from "../../../../../types.ts";
import { requirePermission, json, serverError, csrfCheck, validatePagePath } from "../../../_utils.ts";
import type { FreshContext } from "fresh";

export const handler = {
  async GET(ctx: FreshContext<AdminState>) {
    const denied = requirePermission(ctx, "pages.read");
    if (denied) return denied;
    const { comments } = ctx.state.adminContext;
    if (!comments) return json({ error: "Comments not available" }, 503);
    const pagePath = ctx.params.path;
    if (!validatePagePath(pagePath)) return json({ error: "Invalid path" }, 400);
    try {
      const list = await comments.list(pagePath);
      return json({ items: list, total: list.length });
    } catch (err) {
      return serverError(err);
    }
  },

  async POST(ctx: FreshContext<AdminState>) {
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;
    const denied = requirePermission(ctx, "pages.read");
    if (denied) return denied;
    const { comments } = ctx.state.adminContext;
    if (!comments) return json({ error: "Comments not available" }, 503);

    const authResult = ctx.state.auth;
    if (!authResult.user) return json({ error: "Unauthorized" }, 401);
    const pagePath = ctx.params.path;
    if (!validatePagePath(pagePath)) return json({ error: "Invalid path" }, 400);

    try {
      const body = await ctx.req.json() as { body?: unknown; parentId?: unknown; blockId?: unknown };
      if (!body.body || typeof body.body !== "string") return json({ error: "Missing body" }, 400);
      const newComment = await comments.create(
        pagePath,
        {
          body: body.body,
          parentId: typeof body.parentId === "string" ? body.parentId : undefined,
          blockId: typeof body.blockId === "string" ? body.blockId : undefined,
        },
        authResult.user,
      );
      return json(newComment, 201);
    } catch (err) {
      return serverError(err);
    }
  },
};
