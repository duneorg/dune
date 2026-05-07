/** POST /admin/api/preview */

import type { AdminState } from "../../types.ts";
import { requirePermission, serverError, csrfCheck } from "./_utils.ts";
import type { FreshContext } from "fresh";

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export const handler = {
  async POST(ctx: FreshContext<AdminState>) {
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;
    const denied = requirePermission(ctx, "pages.read");
    if (denied) return denied;

    const { engine } = ctx.state.adminContext;
    try {
      const body = await ctx.req.json();
      const { sourcePath, content } = body;

      if (!sourcePath) {
        return htmlResponse(`<!DOCTYPE html><html><body>${content ?? ""}</body></html>`);
      }

      const pageIndex = engine.pages.find((p) =>
        p.sourcePath === sourcePath || p.sourcePath.includes(sourcePath)
      );

      if (!pageIndex) {
        return htmlResponse(
          `<!DOCTYPE html><html><head><style>body{font-family:system-ui;padding:2rem;max-width:800px;margin:0 auto}</style></head><body>${content ?? ""}</body></html>`,
        );
      }

      const page = await engine.loadPage(pageIndex.sourcePath);
      const html = await page.html();

      return htmlResponse(
        `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:system-ui;padding:2rem;max-width:800px;margin:0 auto;line-height:1.6}img{max-width:100%}pre{background:#f5f5f5;padding:1rem;border-radius:4px;overflow-x:auto}code{background:#f0f0f0;padding:0.1em 0.3em;border-radius:2px}blockquote{border-left:3px solid #ccc;padding-left:1rem;color:#666;margin:1rem 0}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:0.5rem}</style></head><body>${html}</body></html>`,
      );
    } catch (err) {
      return serverError(err);
    }
  },
};
