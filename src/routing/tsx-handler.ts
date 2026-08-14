/** @jsxImportSource preact */
import type { ComponentType } from "preact";
import type { DuneEngine } from "../core/engine.ts";
import type { Page } from "../content/types.ts";
import type { ContentApi } from "../content/api.ts";
import { buildPageTitle } from "../content/types.ts";
import { directionOf } from "../i18n/rtl.ts";
import { createTranslator } from "../i18n/translate.ts";
import { createMediaHelper } from "./link-rewriter.ts";
import { renderErrorPage } from "./error-page.ts";
import { resolveTemplateVNode } from "../themes/resolve-template.ts";
import { resolveThemeConfig } from "./theme-config-resolver.ts";

/**
 * Render a TSX content page, including Fresh-style handler dispatch,
 * layout wrapping, and CSRF guard.
 */
export async function handleTsxPage(
  engine: DuneEngine,
  req: Request,
  url: URL,
  page: Page,
  render: (jsx: unknown, status?: number) => Response | Promise<Response>,
  contentApi?: ContentApi,
): Promise<Response> {
  // Dispatch through Fresh-style `export const handler` if present.
  const pageHandlers = await page.handlers();
  if (pageHandlers) {
    const method = req.method.toUpperCase();
    const methodFn = pageHandlers[method] ?? pageHandlers["ALL"];
    if (methodFn) {
      const Component = await page.component();
      const ctx = {
        req,
        url,
        params: {},
        render: async (data: unknown) => {
          if (!Component) {
            return renderErrorPage(engine, url, render, 500, "TSX component not found", contentApi);
          }
          return render(await resolveTemplateVNode(Component as ComponentType<any>, {
            data,
            site: engine.site,
            config: engine.config,
            nav: engine.router.getTopNavigation(page.language),
            navAll: engine.router.getNavigation(page.language),
            translations: engine.router.getTranslations(page.route),
            route: page.route,
            params: {},
            content: contentApi,
          }));
        },
        /**
         * Same-origin CSRF guard for mutating handlers.
         * Returns 403 if Origin is present and cross-site, null otherwise.
         */
        csrfCheck: (): Response | null => {
          const m = req.method;
          if (m === "GET" || m === "HEAD" || m === "OPTIONS") return null;
          const origin = req.headers.get("origin");
          if (origin === null) return null;
          try {
            if (new URL(origin).host !== url.host) {
              return Response.json(
                { error: "Forbidden: cross-origin request rejected" },
                { status: 403 },
              );
            }
          } catch {
            return Response.json(
              { error: "Forbidden: cross-origin request rejected" },
              { status: 403 },
            );
          }
          return null;
        },
      };
      return methodFn(req, ctx);
    }
    // No handler for this method — fall through to normal rendering.
  }

  const Component = await page.component();
  if (!Component) {
    return renderErrorPage(engine, url, render, 500, "TSX component not found", contentApi);
  }

  const layoutName = page.frontmatter.layout;
  if (layoutName === false) {
    return render(
      await resolveTemplateVNode(Component as ComponentType<any>, {
        site: engine.site,
        config: engine.config,
        route: page.route,
        media: createMediaHelper(page.media),
        params: {},
        content: contentApi,
      }),
    );
  }

  const layout = await engine.themes.loadLayout(
    typeof layoutName === "string" ? layoutName : "default",
  );

  const content = await resolveTemplateVNode(Component as ComponentType<any>, {
    site: engine.site,
    config: engine.config,
    route: page.route,
    media: createMediaHelper(page.media),
    params: {},
    content: contentApi,
  });

  if (layout) {
    const strings = await engine.themes.loadLocale(page.language ?? "en");
    const t = createTranslator(strings);
    const pageLangForDir = page.language ?? engine.config?.system?.languages?.default ?? "en";
    return render(
      await resolveTemplateVNode(layout as ComponentType<any>, {
        page,
        pageTitle: buildPageTitle(page, engine.site.title),
        site: engine.site,
        config: engine.config,
        nav: engine.router.getTopNavigation(page.language),
        navAll: engine.router.getNavigation(page.language),
        translations: engine.router.getTranslations(page.route),
        pathname: url.pathname,
        search: url.search,
        themeConfig: await resolveThemeConfig(page, engine),
        t,
        dir: directionOf(pageLangForDir, engine.config?.system?.languages?.rtl_override),
        children: content,
        content: contentApi,
      }),
    );
  }

  return render(content);
}
