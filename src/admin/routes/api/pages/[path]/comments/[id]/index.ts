/** PATCH + DELETE /admin/api/pages/:path/comments/:id */

import type { AdminState } from "../../../../../../types.ts";
import { requirePermission, json, serverError, csrfCheck } from "../../../../_utils.ts";
import type { FreshContext } from "fresh";

export const handler = {
  async PATCH(ctx: FreshContext<AdminState>) {
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;
    const denied = requirePermission(ctx, "pages.read");
    if (denied) return denied;

    const { comments, auth } = ctx.state.adminContext;
    if (!comments) return json({ error: "Comments not available" }, 503);
    const { path: pagePath, id } = ctx.params;
    const authResult = ctx.state.auth;

    try {
      const existing = await comments.get(pagePath, id);
      if (!existing) return json({ error: "Comment not found" }, 404);

      const canModify = existing.authorUsername === authResult.user?.username ||
        auth.hasPermission(authResult, "pages.delete");
      if (!canModify) return json({ error: "Forbidden" }, 403);

      const body = await ctx.req.json() as { body?: unknown };
      if (!body.body || typeof body.body !== "string") return json({ error: "Missing body" }, 400);
      const updated = await comments.update(pagePath, id, body.body);
      return json(updated);
    } catch (err) {
      return serverError(err);
    }
  },

  async DELETE(ctx: FreshContext<AdminState>) {
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;
    const denied = requirePermission(ctx, "pages.read");
    if (denied) return denied;

    const { comments, auth } = ctx.state.adminContext;
    if (!comments) return json({ error: "Comments not available" }, 503);
    const { path: pagePath, id } = ctx.params;
    const authResult = ctx.state.auth;

    try {
      const existing = await comments.get(pagePath, id);
      if (!existing) return json({ error: "Comment not found" }, 404);

      const canModify = existing.authorUsername === authResult.user?.username ||
        auth.hasPermission(authResult, "pages.delete");
      if (!canModify) return json({ error: "Forbidden" }, 403);

      await comments.delete(pagePath, id);
      return json({ ok: true });
    } catch (err) {
      return serverError(err);
    }
  },
};
