/** POST /admin/api/pages/:path/comments/:id/resolve */

import type { AdminState } from "../../../../../../types.ts";
import { requirePermission, json, serverError, csrfCheck, validatePagePath } from "../../../../_utils.ts";
import type { FreshContext } from "fresh";

export const handler = {
  async POST(ctx: FreshContext<AdminState>) {
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;
    const denied = requirePermission(ctx, "pages.read");
    if (denied) return denied;

    const { comments } = ctx.state.adminContext;
    if (!comments) return json({ error: "Comments not available" }, 503);

    const { path: pagePath, id } = ctx.params;
    if (!validatePagePath(pagePath)) return json({ error: "Invalid path" }, 400);
    const authResult = ctx.state.auth;
    if (!authResult.user) return json({ error: "Unauthorized" }, 401);

    try {
      const resolved = await comments.resolve(pagePath, id, authResult.user.username);
      if (!resolved) return json({ error: "Comment not found" }, 404);
      return json(resolved);
    } catch (err) {
      return serverError(err);
    }
  },
};
