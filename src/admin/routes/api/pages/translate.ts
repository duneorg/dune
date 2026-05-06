/** POST /admin/api/pages/translate */


import type { AdminState } from "../../../types.ts";
import { requirePermission, json, serverError, csrfCheck } from "../_utils.ts";
import { getAdminContext } from "../../../context.ts";
import { dirname, basename } from "@std/path";
import { parseContentFilename } from "../../../../content/path-utils.ts";
import type { FreshContext } from "fresh";

export const handler = {
  async POST(ctx: FreshContext<AdminState>) {
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;
    const denied = requirePermission(ctx, "pages.create");
    if (denied) return denied;

    const { engine, storage, config } = getAdminContext();
    try {
      const { sourcePath, lang } = await ctx.req.json();
      const supportedLangs = engine.config.system.languages?.supported ?? [];

      if (!sourcePath || typeof sourcePath !== "string" || !lang || typeof lang !== "string") {
        return json({ error: "sourcePath and lang required" }, 400);
      }
      if (!supportedLangs.includes(lang)) return json({ error: "Unsupported language" }, 400);

      const dir = dirname(sourcePath);
      const filename = basename(sourcePath);
      const fileInfo = parseContentFilename(filename, supportedLangs);
      if (!fileInfo) return json({ error: "Cannot parse source path" }, 400);

      const contentDir = config.system.content.dir;
      const targetPath = `${dir}/${fileInfo.template}.${lang}${fileInfo.ext}`;

      if (engine.pages.some((p) => p.sourcePath === targetPath)) {
        return json({ error: "Translation already exists" }, 409);
      }

      const sourceBytes = await storage.read(`${contentDir}/${sourcePath}`);
      await storage.write(`${contentDir}/${targetPath}`, sourceBytes);
      await engine.rebuild();

      return json({ created: true, path: targetPath });
    } catch (err) {
      return serverError(err);
    }
  },
};
