/** POST /admin/api/i18n/memory/rebuild */

import type { AdminState } from "../../../../types.ts";
import { requirePermission, json, serverError, csrfCheck } from "../../_utils.ts";
import { loadTM, saveTM, buildTMFromPages } from "../../../../tm.ts";
import { dirname, basename } from "@std/path";
import { parseContentFilename } from "../../../../../content/path-utils.ts";
import type { FreshContext } from "fresh";

export const handler = {
  async POST(ctx: FreshContext<AdminState>) {
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;
    const denied = requirePermission(ctx, "pages.read");
    if (denied) return denied;

    const { storage, config, engine } = ctx.state.adminContext;
    try {
      const supported = config.system.languages?.supported ?? [];
      const body = await ctx.req.json();
      const { from, to } = body;

      if (!supported.includes(from) || !supported.includes(to)) {
        return json({ error: "Valid from and to language codes required" }, 400);
      }

      const contentDir = config.system.content.dir;
      const tm = await loadTM(storage, contentDir, from, to);
      let added = 0;

      const sourceLangPages = engine.pages.filter((p) => p.language === from);
      for (const sourcePage of sourceLangPages) {
        const filename = basename(sourcePage.sourcePath);
        const fileInfo = parseContentFilename(filename, supported);
        if (!fileInfo) continue;

        const dir = dirname(sourcePage.sourcePath);
        const targetPath = `${dir}/${fileInfo.template}.${to}${fileInfo.ext}`;
        if (!engine.pages.some((p) => p.sourcePath === targetPath)) continue;

        try {
          const [sourceLoaded, targetLoaded] = await Promise.all([
            engine.loadPage(sourcePage.sourcePath),
            engine.loadPage(targetPath),
          ]);
          if (!sourceLoaded.rawContent || !targetLoaded.rawContent) continue;
          const pairs = buildTMFromPages(sourceLoaded.rawContent, targetLoaded.rawContent);
          for (const [src, tgt] of Object.entries(pairs)) {
            if (!tm[src]) { tm[src] = tgt; added++; }
          }
        } catch { /* skip */ }
      }

      await saveTM(storage, contentDir, from, to, tm);
      return json({ ok: true, added });
    } catch (err) {
      return serverError(err);
    }
  },
};
