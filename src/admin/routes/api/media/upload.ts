/** POST /admin/api/media/upload */


import type { AdminState } from "../../../types.ts";
import { requirePermission, json, serverError, actorFromAuth, getClientIp, csrfCheck } from "../_utils.ts";
import { getAdminContext } from "../../../context.ts";
import { dirname } from "@std/path";
import { isMediaFile, dirPathToRoute } from "../../../../content/path-utils.ts";
import { getMimeType } from "../../../../content/page-loader.ts";
import { checkBodySize } from "../../../../security/body-limit.ts";
import type { FreshContext } from "fresh";

export const handler = {
  async POST(ctx: FreshContext<AdminState>) {
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;
    const denied = requirePermission(ctx, "media.upload");
    if (denied) return denied;

    const { storage, config, auditLogger } = getAdminContext();
    const MAX_FILE_SIZE = 50 * 1024 * 1024;
    const maxBodyBytes = (config.admin?.maxUploadMb ?? 100) * 1024 * 1024;

    try {
      const tooLarge = checkBodySize(ctx.req, maxBodyBytes);
      if (tooLarge) return tooLarge;

      const formData = await ctx.req.formData();
      const file = formData.get("file");
      const pagePath = formData.get("pagePath");

      if (!file || !(file instanceof File)) return json({ error: "file required" }, 400);
      if (!pagePath || typeof pagePath !== "string") return json({ error: "pagePath required" }, 400);

      const safeName = file.name
        .replace(/[/\\:*?"<>|]/g, "_")
        .replace(/\s+/g, "_")
        .replace(/_{2,}/g, "_")
        .replace(/^\.+/, "")
        .slice(0, 200);

      if (!safeName || !isMediaFile(safeName)) return json({ error: "unsupported file type" }, 400);
      if (file.size > MAX_FILE_SIZE) return json({ error: "file too large (max 50 MB)" }, 400);

      const contentDir = config.system.content.dir;
      const pageDir = dirname(pagePath);
      if (pageDir.includes("..") || pagePath.includes("..")) return json({ error: "invalid pagePath" }, 400);

      const destPath = `${contentDir}/${pageDir}/${safeName}`;
      const bytes = new Uint8Array(await file.arrayBuffer());
      await storage.write(destPath, bytes);

      const url = `${dirPathToRoute(pageDir)}/${safeName}`;
      const mimeType = getMimeType(safeName);

      void auditLogger?.log({
        event: "media.upload",
        actor: actorFromAuth(ctx.state.auth),
        ip: getClientIp(ctx.req),
        userAgent: ctx.req.headers.get("user-agent") ?? null,
        target: { type: "media", id: safeName },
        detail: {},
        outcome: "success",
      }).catch(() => {});

      return json({ ok: true, item: { name: safeName, url, type: mimeType, size: bytes.length, pagePath } });
    } catch (err) {
      return serverError(err);
    }
  },
};
