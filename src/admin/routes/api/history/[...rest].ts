/**
 * History API — catch-all under /admin/api/history/
 *
 * GET  /admin/api/history/:encodedPath          → list revisions
 * GET  /admin/api/history/:encodedPath/:revNum  → get single revision
 * GET  /admin/api/history/:encodedPath/:revNum/diff     → diff vs current
 * POST /admin/api/history/:encodedPath/:revNum/restore  → restore revision
 */

import type { AdminState } from "../../../types.ts";
import { requirePermission, json, serverError, csrfCheck, validatePagePath } from "../_utils.ts";
import { stringify as stringifyYaml } from "@std/yaml";
import type { FreshContext } from "fresh";

export const handler = {
  async GET(ctx: FreshContext<AdminState>) {
    const denied = requirePermission(ctx, "pages.read");
    if (denied) return denied;

    const { history: hist, engine } = ctx.state.adminContext;
    if (!hist) return json({ error: "History not enabled" }, 501);

    // rest = "encodedPath" | "encodedPath/revNum" | "encodedPath/revNum/diff"
    const rest = ctx.params.rest;
    const parts = rest.split("/");
    const pagePath = decodeURIComponent(parts[0]);
    if (!validatePagePath(pagePath)) return json({ error: "Invalid path" }, 400);

    try {
      if (parts.length === 1) {
        // GET list
        const revisions = await hist.getHistory(pagePath);
        return json({ items: revisions, total: revisions.length });
      }

      const revNum = parseInt(parts[1], 10);

      if (parts.length === 2) {
        // GET single revision
        const revision = await hist.getRevision(pagePath, revNum);
        if (!revision) return json({ error: "Revision not found" }, 404);
        return json(revision);
      }

      if (parts.length === 3 && parts[2] === "diff") {
        // GET diff
        const pageIndex = engine.pages.find((p) => p.sourcePath === pagePath);
        if (!pageIndex) return json({ error: "Page not found" }, 404);
        const page = await engine.loadPage(pageIndex.sourcePath);
        const diff = await hist.diffWithCurrent(pagePath, revNum, page.rawContent ?? "");
        if (!diff) return json({ error: "Revision not found" }, 404);
        return json(diff);
      }

      return json({ error: "Not found" }, 404);
    } catch (err) {
      return serverError(err);
    }
  },

  async POST(ctx: FreshContext<AdminState>) {
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;
    const denied = requirePermission(ctx, "pages.update");
    if (denied) return denied;

    const { history: hist, engine, storage, config } = ctx.state.adminContext;
    if (!hist) return json({ error: "History not enabled" }, 501);

    const rest = ctx.params.rest;
    const parts = rest.split("/");

    if (parts.length !== 3 || parts[2] !== "restore") {
      return json({ error: "Not found" }, 404);
    }

    const pagePath = decodeURIComponent(parts[0]);
    if (!validatePagePath(pagePath)) return json({ error: "Invalid path" }, 400);
    const revNum = parseInt(parts[1], 10);

    try {
      const revision = await hist.getRevision(pagePath, revNum);
      if (!revision) return json({ error: "Revision not found" }, 404);

      const pageIndex = engine.pages.find((p) => p.sourcePath === pagePath);
      if (!pageIndex) return json({ error: "Page not found" }, 404);

      const contentDir = config.system.content.dir;
      const filePath = `${contentDir}/${pageIndex.sourcePath}`;
      const fmYaml = stringifyYaml(revision.frontmatter as Record<string, unknown>).trimEnd();
      const fullContent = `---\n${fmYaml}\n---\n\n${revision.content}`;

      await storage.write(filePath, new TextEncoder().encode(fullContent));
      await engine.rebuild();

      return json({ restored: true, revision: revNum });
    } catch (err) {
      return serverError(err);
    }
  },
};
