/** GET /admin/api/theme-preview?theme=X&route=/path */


import type { AdminState } from "../../types.ts";
import { requirePermission, serverError } from "./_utils.ts";
import { getAdminContext } from "../../context.ts";
import { h, type ComponentType } from "preact";
import { render as renderJsxToString } from "preact-render-to-string";
import { buildPageTitle } from "../../../content/types.ts";
import type { FreshContext } from "fresh";

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export const handler = {
  async GET(ctx: FreshContext<AdminState>) {
    const denied = requirePermission(ctx, "config.read");
    if (denied) return denied;

    const { engine } = getAdminContext();
    const themeName = ctx.url.searchParams.get("theme") ?? "";
    const route = ctx.url.searchParams.get("route") || "/";

    const available = await engine.getAvailableThemes();
    if (!available.includes(themeName)) {
      return htmlResponse(
        `<!DOCTYPE html><html><body><p>⚠ Theme <code>${escapeHtml(themeName)}</code> not found.</p></body></html>`,
        404,
      );
    }

    const pageIndex = engine.pages.find((p) => p.route === route && p.published && p.routable);
    if (!pageIndex) {
      return htmlResponse(
        `<!DOCTYPE html><html><body><p>⚠ No published page at route <code>${escapeHtml(route)}</code>.</p></body></html>`,
        404,
      );
    }

    try {
      if (pageIndex.format === "tsx") {
        return htmlResponse(
          `<!DOCTYPE html><html><body><p>ℹ TSX pages are self-rendering and cannot be previewed with a different theme.</p></body></html>`,
        );
      }

      const [page, previewLoader] = await Promise.all([
        engine.loadPage(pageIndex.sourcePath),
        engine.createPreviewTheme(themeName),
      ]);

      const html = await page.html();
      const templateName = previewLoader.resolveTemplateName(page) ?? "default";
      const template = await previewLoader.loadTemplate(templateName);

      if (!template) {
        const pageTitle = buildPageTitle(page, engine.site.title);
        return htmlResponse(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(pageTitle)}</title><style>body{font-family:system-ui;max-width:800px;margin:2rem auto;padding:0 1rem;line-height:1.6}img{max-width:100%}</style></head><body><h1>${escapeHtml(page.frontmatter.title ?? "")}</h1><div>${html}</div></body></html>`);
      }

      const layout = await previewLoader.loadLayout("layout");
      const strings = await previewLoader.loadLocale(pageIndex.language ?? "en");
      const t = (key: string) => (strings[key] ?? key) as string;

      const rendered = renderJsxToString(
        h((template.component as unknown) as ComponentType<Record<string, unknown>>, {
          page,
          pageTitle: buildPageTitle(page, engine.site.title),
          site: engine.site,
          config: engine.config,
          nav: engine.router.getTopNavigation(pageIndex.language),
          pathname: route,
          search: "",
          Layout: layout ?? null,
          themeConfig: engine.themeConfig,
          t,
          children: h("div", { dangerouslySetInnerHTML: { __html: html } }),
        }),
      );

      return htmlResponse(`<!DOCTYPE html>${rendered}`);
    } catch (err) {
      return serverError(err);
    }
  },
};
