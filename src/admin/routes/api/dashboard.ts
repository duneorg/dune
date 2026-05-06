/** GET /admin/api/dashboard */

import type { AdminState } from "../../types.ts";
import { json } from "./_utils.ts";
import type { FreshContext } from "fresh";

function toUserInfo(u: { id: string; username: string; name: string; email: string; role: string; enabled: boolean }) {
  return { id: u.id, username: u.username, name: u.name, email: u.email, role: u.role, enabled: u.enabled };
}

export const handler = {
  GET(ctx: FreshContext<AdminState>) {
    const { engine } = ctx.state.adminContext;
    const authResult = ctx.state.auth;
    return json({
      pages: {
        total: engine.pages.length,
        published: engine.pages.filter((p) => p.published).length,
        draft: engine.pages.filter((p) => !p.published).length,
      },
      formats: {
        md: engine.pages.filter((p) => p.format === "md").length,
        mdx: engine.pages.filter((p) => p.format === "mdx").length,
        tsx: engine.pages.filter((p) => p.format === "tsx").length,
      },
      user: authResult.user ? toUserInfo(authResult.user as Parameters<typeof toUserInfo>[0]) : null,
    });
  },
};
