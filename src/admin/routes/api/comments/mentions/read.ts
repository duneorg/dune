/** POST /admin/api/comments/mentions/read */

import type { AdminState } from "../../../../types.ts";
import { requirePermission, json, csrfCheck } from "../../_utils.ts";
import type { FreshContext } from "fresh";

export const handler = {
  async POST(ctx: FreshContext<AdminState>) {
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;
    const denied = requirePermission(ctx, "pages.read");
    if (denied) return denied;
    const { comments } = ctx.state.adminContext;
    const authResult = ctx.state.auth;
    if (!comments || !authResult.user) return json({ ok: true });
    const body = await ctx.req.json().catch(() => ({})) as { ids?: unknown };
    const ids: string[] = Array.isArray(body.ids) ? body.ids as string[] : [];
    await comments.markRead(authResult.user.username, ids);
    return json({ ok: true });
  },
};
