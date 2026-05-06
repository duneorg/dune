/** POST /admin/api/pages/reorder */


import type { AdminState } from "../../../types.ts";
import { requirePermission, json, serverError, validatePagePath, csrfCheck } from "../_utils.ts";
import { getAdminContext } from "../../../context.ts";
import { dirname, basename } from "@std/path";
import type { FreshContext } from "fresh";

export const handler = {
  async POST(ctx: FreshContext<AdminState>) {
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;
    const denied = requirePermission(ctx, "pages.update");
    if (denied) return denied;

    const { engine, storage, config } = getAdminContext();
    try {
      const body = await ctx.req.json() as {
        sourcePath: string; targetPath: string | null; position?: "before" | "after";
      };
      const { sourcePath, targetPath } = body;
      const position = body.position ?? "before";

      if (!sourcePath) return json({ error: "sourcePath required" }, 400);
      if (!validatePagePath(sourcePath)) return json({ error: "Invalid sourcePath" }, 400);
      if (targetPath && !validatePagePath(targetPath)) return json({ error: "Invalid targetPath" }, 400);

      const source = engine.pages.find((p) => p.sourcePath === sourcePath);
      if (!source) return json({ error: "Source page not found" }, 404);
      if (source.order === 0) return json({ error: "Source page has no numeric prefix and cannot be reordered" }, 400);

      const target = targetPath ? engine.pages.find((p) => p.sourcePath === targetPath) : null;
      if (targetPath && !target) return json({ error: "Target page not found" }, 404);
      if (target && source.parentPath !== target.parentPath) {
        return json({ error: "Pages must be siblings" }, 400);
      }

      const siblings = engine.pages
        .filter((p) => p.parentPath === source.parentPath && p.depth === source.depth && p.order > 0)
        .sort((a, b) => a.order - b.order);

      const newOrder = siblings.filter((p) => p.sourcePath !== sourcePath);
      let insertIdx: number;
      if (!target) {
        insertIdx = newOrder.length;
      } else {
        const tgtIdx = newOrder.findIndex((p) => p.sourcePath === targetPath);
        insertIdx = position === "after" ? tgtIdx + 1 : tgtIdx;
      }
      if (insertIdx < 0 || insertIdx > newOrder.length) insertIdx = newOrder.length;
      newOrder.splice(insertIdx, 0, source);

      const contentDir = config.system.content.dir;
      const renames: Array<{ oldDir: string; newDir: string }> = [];

      for (let i = 0; i < newOrder.length; i++) {
        const page = newOrder[i];
        const newNum = i + 1;
        if (page.order === newNum) continue;

        const fullPath = `${contentDir}/${page.sourcePath}`;
        const oldDir = dirname(fullPath);
        const folderName = basename(oldDir);
        const match = folderName.match(/^(\d+)\.(.*)/);
        if (!match) continue;

        const newFolderName = String(newNum).padStart(2, "0") + "." + match[2];
        renames.push({ oldDir, newDir: `${dirname(oldDir)}/${newFolderName}` });
      }

      if (renames.length === 0) return json({ reordered: true });

      const tmpSuffix = `__reorder_${Date.now()}__`;
      const tempRenames: Array<{ tmpDir: string; newDir: string }> = [];
      for (const r of renames) {
        const tmpDir = r.oldDir + tmpSuffix;
        await storage.rename(r.oldDir, tmpDir);
        tempRenames.push({ tmpDir, newDir: r.newDir });
      }
      for (const r of tempRenames) {
        await storage.rename(r.tmpDir, r.newDir);
      }

      await engine.rebuild();
      return json({ reordered: true });
    } catch (err) {
      return serverError(err);
    }
  },
};
