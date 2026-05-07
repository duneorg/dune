/** POST /admin/api/staging/:path/publish */

import type { AdminState } from "../../../../types.ts";
import { requirePermission, json, serverError, csrfCheck, validatePagePath } from "../../_utils.ts";
import { stringify as stringifyYaml } from "@std/yaml";
import type { FreshContext } from "fresh";

async function maybeGitCommit(
  filePath: string, sourcePath: string, author: string | undefined,
  adminGitCommit: boolean | undefined,
): Promise<void> {
  if (!adminGitCommit) return;
  try {
    const msg = author ? `Admin: update ${sourcePath} (by ${author})` : `Admin: update ${sourcePath}`;
    await new Deno.Command("git", { args: ["add", filePath], stderr: "inherit" }).output();
    await new Deno.Command("git", { args: ["commit", "-m", msg], stderr: "inherit", stdout: "null" }).output();
  } catch (err) {
    console.warn(`[dune] git commit failed: ${err instanceof Error ? err.message : err}`);
  }
}

export const handler = {
  async POST(ctx: FreshContext<AdminState>) {
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;
    const denied = requirePermission(ctx, "pages.update");
    if (denied) return denied;

    const { staging, engine, storage, config, history: hist } = ctx.state.adminContext;
    if (!staging) return json({ error: "Staging not enabled" }, 501);

    const pagePath = ctx.params.path;
    if (!validatePagePath(pagePath)) return json({ error: "Invalid path" }, 400);
    const authResult = ctx.state.auth;

    try {
      const draft = await staging.get(pagePath);
      if (!draft) return json({ error: "No draft found for this page" }, 404);

      const pageIndex = engine.pages.find((p) => p.sourcePath === pagePath);
      if (!pageIndex) return json({ error: "Page not found" }, 404);

      const contentDir = config.system.content.dir;
      const filePath = `${contentDir}/${pageIndex.sourcePath}`;
      const fmYaml = stringifyYaml(draft.frontmatter as Record<string, unknown>).trimEnd();
      const fullContent = `---\n${fmYaml}\n---\n\n${draft.content}`;

      await storage.write(filePath, new TextEncoder().encode(fullContent));

      if (hist) {
        await hist.record({
          sourcePath: pagePath,
          content: draft.content,
          frontmatter: draft.frontmatter,
          author: authResult.user?.name,
          message: "Published from staging",
        });
      }

      await maybeGitCommit(filePath, pagePath, authResult.user?.name, config.admin?.git_commit);
      await staging.discard(pagePath);
      await engine.rebuild();

      return json({ published: true, sourcePath: pagePath });
    } catch (err) {
      return serverError(err);
    }
  },
};
