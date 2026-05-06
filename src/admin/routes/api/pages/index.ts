/** GET + POST /admin/api/pages */

import type { AdminState } from "../../../types.ts";
import { requirePermission, json, serverError, actorFromAuth, getClientIp, validatePagePath, csrfCheck } from "../_utils.ts";
import { fireContentWebhooks } from "../../../../admin/webhooks.ts";
import type { FreshContext } from "fresh";

export const handler = {
  GET(ctx: FreshContext<AdminState>) {
    const denied = requirePermission(ctx, "pages.read");
    if (denied) return denied;
    const { engine } = ctx.state.adminContext;
    return json({
      items: engine.pages.map((p) => ({
        route: p.route, title: p.title, sourcePath: p.sourcePath,
        format: p.format, template: p.template, published: p.published,
        date: p.date, order: p.order, depth: p.depth,
        parentPath: p.parentPath, isModule: p.isModule,
      })),
      total: engine.pages.length,
    });
  },

  async POST(ctx: FreshContext<AdminState>) {
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;
    const denied = requirePermission(ctx, "pages.create");
    if (denied) return denied;

    const { engine, storage, config, hooks, auditLogger } = ctx.state.adminContext;
    const authResult = ctx.state.auth;
    try {
      const body = await ctx.req.json();
      const { path: pagePath, title, content, template, format, file, file_url } = body;

      if (!pagePath || !title) return json({ error: "path and title are required" }, 400);
      if (!validatePagePath(pagePath)) {
        return json({ error: "Invalid page path: must not contain '..' or absolute segments" }, 400);
      }

      const ext = format === "mdx" ? ".mdx" : format === "tsx" ? ".tsx" : ".md";
      let fm = `---\ntitle: "${title}"\ntemplate: ${template ?? "default"}\npublished: true\n`;
      if (file && typeof file === "string") fm += `file: "${file}"\n`;
      if (file_url && typeof file_url === "string") fm += `file_url: "${file_url}"\n`;
      fm += `---\n`;

      const defaultContent = (file_url && typeof file_url === "string")
        ? `[⬇ ${title}](${file_url})\n`
        : (content ?? "");

      const contentDir = config.system.content.dir;
      const filePath = `${contentDir}/${pagePath}/default${ext}`;
      await storage.write(filePath, new TextEncoder().encode(fm + "\n" + defaultContent));
      await engine.rebuild();

      const webhookEndpoints = config.admin?.webhooks ?? [];
      const runtimeDir = config.admin?.runtimeDir ?? ".dune/admin";
      if (hooks) hooks.fire("onPageCreate", { sourcePath: `${pagePath}/default${ext}`, title }).catch(() => {});
      fireContentWebhooks(webhookEndpoints, "onPageCreate", { sourcePath: `${pagePath}/default${ext}`, title }, runtimeDir);

      void auditLogger?.log({
        event: "page.create",
        actor: actorFromAuth(authResult),
        ip: getClientIp(ctx.req),
        userAgent: ctx.req.headers.get("user-agent") ?? null,
        target: { type: "page", id: filePath },
        detail: {},
        outcome: "success",
      }).catch(() => {});

      return json({ created: true, path: pagePath, file: filePath }, 201);
    } catch (err) {
      return serverError(err);
    }
  },
};
