/** GET + POST + DELETE /admin/api/staging/:path */


import type { AdminState } from "../../../../types.ts";
import { requirePermission, json, serverError, csrfCheck } from "../../_utils.ts";
import { getAdminContext } from "../../../../context.ts";
import type { FreshContext } from "fresh";

export const handler = {
  async GET(ctx: FreshContext<AdminState>) {
    const denied = requirePermission(ctx, "pages.read");
    if (denied) return denied;
    const { staging } = getAdminContext();
    if (!staging) return json({ error: "Staging not enabled" }, 501);

    const pagePath = ctx.params.path;
    const draft = await staging.get(pagePath);
    if (!draft) return json({ draft: null });

    const previewUrl = `/__preview?path=${encodeURIComponent(pagePath)}&token=${draft.token}`;
    return json({
      draft: {
        sourcePath: draft.sourcePath,
        token: draft.token,
        updatedAt: draft.updatedAt,
        createdBy: draft.createdBy,
        previewUrl,
      },
    });
  },

  async POST(ctx: FreshContext<AdminState>) {
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;
    const denied = requirePermission(ctx, "pages.update");
    if (denied) return denied;

    const { staging } = getAdminContext();
    if (!staging) return json({ error: "Staging not enabled" }, 501);

    const pagePath = ctx.params.path;
    const authResult = ctx.state.auth;
    try {
      const body = await ctx.req.json() as { content?: string; frontmatter?: Record<string, unknown> };
      const draft = await staging.upsert({
        sourcePath: pagePath,
        content: body.content ?? "",
        frontmatter: body.frontmatter ?? {},
        createdBy: authResult.user?.name,
      });
      const previewUrl = `/__preview?path=${encodeURIComponent(pagePath)}&token=${draft.token}`;
      return json({ ok: true, token: draft.token, previewUrl, updatedAt: draft.updatedAt });
    } catch (err) {
      return serverError(err);
    }
  },

  async DELETE(ctx: FreshContext<AdminState>) {
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;
    const denied = requirePermission(ctx, "pages.update");
    if (denied) return denied;
    const { staging } = getAdminContext();
    if (!staging) return json({ error: "Staging not enabled" }, 501);
    await staging.discard(ctx.params.path);
    return json({ discarded: true });
  },
};
