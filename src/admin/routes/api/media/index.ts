/** GET /admin/api/media — list; DELETE /admin/api/media — delete */


import type { AdminState } from "../../../types.ts";
import { requirePermission, json, serverError, actorFromAuth, getClientIp, csrfCheck } from "../_utils.ts";
import { getAdminContext } from "../../../context.ts";
import { dirname } from "@std/path";
import { isMediaFile } from "../../../../content/path-utils.ts";
import type { FreshContext } from "fresh";

export const handler = {
  async GET(ctx: FreshContext<AdminState>) {
    const denied = requirePermission(ctx, "media.read");
    if (denied) return denied;

    const { engine } = getAdminContext();
    try {
      const items: Array<{
        name: string; url: string; type: string; size: number; pagePath: string; meta: Record<string, unknown>;
      }> = [];

      for (const pageIndex of engine.pages) {
        try {
          const page = await engine.loadPage(pageIndex.sourcePath);
          for (const media of page.media) {
            items.push({ name: media.name, url: media.url, type: media.type, size: media.size, pagePath: pageIndex.sourcePath, meta: media.meta });
          }
        } catch { /* skip unloadable pages */ }
      }

      return json({ items, total: items.length });
    } catch (err) {
      return serverError(err);
    }
  },

  async DELETE(ctx: FreshContext<AdminState>) {
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;
    const denied = requirePermission(ctx, "media.delete");
    if (denied) return denied;

    const { storage, config, auditLogger } = getAdminContext();
    try {
      const body = await ctx.req.json();
      const { pagePath, name } = body;

      if (!pagePath || typeof pagePath !== "string" || !name || typeof name !== "string") {
        return json({ error: "pagePath and name required" }, 400);
      }
      if (pagePath.includes("..") || name.includes("..") || name.includes("/") || name.includes("\\")) {
        return json({ error: "invalid path" }, 400);
      }
      if (!isMediaFile(name)) return json({ error: "not a media file" }, 400);

      const contentDir = config.system.content.dir;
      const pageDir = dirname(pagePath);
      const filePath = `${contentDir}/${pageDir}/${name}`;

      await storage.delete(filePath);

      try {
        const sidecarPath = `${filePath}.meta.yaml`;
        if (await storage.exists(sidecarPath)) await storage.delete(sidecarPath);
      } catch { /* ignore */ }

      void auditLogger?.log({
        event: "media.delete",
        actor: actorFromAuth(ctx.state.auth),
        ip: getClientIp(ctx.req),
        userAgent: ctx.req.headers.get("user-agent") ?? null,
        target: { type: "media", id: name },
        detail: {},
        outcome: "success",
      }).catch(() => {});

      return json({ ok: true });
    } catch (err) {
      return serverError(err);
    }
  },
};
