/** @jsxImportSource preact */
import { h, type ComponentType } from "preact";
import type { DuneEngine } from "../core/engine.ts";
import type { Page } from "../content/types.ts";
import { buildPageTitle } from "../content/types.ts";
import { directionOf } from "../i18n/rtl.ts";
import { createMediaHelper } from "./link-rewriter.ts";

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
          if (!Component) return new Response("TSX component not found", { status: 500 });
          return render(h(Component as ComponentType<any>, {
            data,
            site: engine.site,
            config: engine.config,
            nav: engine.router.getTopNavigation(page.language),
            route: page.route,
            params: {},
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
    return new Response("TSX component not found", { status: 500 });
  }

  const layoutName = page.frontmatter.layout;
  if (layoutName === false) {
    return render(
      h(Component as ComponentType<any>, {
        site: engine.site,
        config: engine.config,
        route: page.route,
        media: createMediaHelper(page.media),
        params: {},
      }),
    );
  }

  const layout = await engine.themes.loadLayout(
    typeof layoutName === "string" ? layoutName : "default",
  );

  const content = h(Component as ComponentType<any>, {
    site: engine.site,
    config: engine.config,
    route: page.route,
    media: createMediaHelper(page.media),
    params: {},
  });

  if (layout) {
    const strings = await engine.themes.loadLocale(page.language ?? "en");
    const t = (key: string) => (strings[key] ?? key) as string;
    const pageLangForDir = page.language ?? engine.config?.system?.languages?.default ?? "en";
    return render(
      h(layout as ComponentType<any>, {
        page,
        pageTitle: buildPageTitle(page, engine.site.title),
        site: engine.site,
        config: engine.config,
        nav: engine.router.getTopNavigation(page.language),
        pathname: url.pathname,
        search: url.search,
        themeConfig: engine.themeConfig,
        t,
        dir: directionOf(pageLangForDir, engine.config?.system?.languages?.rtl_override),
        children: content,
      }),
    );
  }

  return render(content);
}
