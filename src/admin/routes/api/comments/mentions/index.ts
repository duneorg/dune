/** GET /admin/api/comments/mentions */


import type { AdminState } from "../../../../types.ts";
import { requirePermission, json } from "../../_utils.ts";
import { getAdminContext } from "../../../../context.ts";
import type { FreshContext } from "fresh";

export const handler = {
  async GET(ctx: FreshContext<AdminState>) {
    const denied = requirePermission(ctx, "pages.read");
    if (denied) return denied;
    const { comments } = getAdminContext();
    const authResult = ctx.state.auth;
    if (!comments || !authResult.user) return json([]);
    const mentions = await comments.listMentions(authResult.user.username);
    return json(mentions);
  },
};
