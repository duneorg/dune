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
import { requireAuth } from "../auth/api-guard.ts";
import { navigationForRequest } from "../auth/gating.ts";
import { checkSameOriginCsrf } from "../security/csrf.ts";

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
  // Resolved once per request and threaded into every ContentPageProps
  // construction below — the same User (or null) a Fresh route handler
  // would get via fc.state.siteUser, or a generated CRUD route via
  // requireAuth() reading the internal x-dune-user header. "none"
  // mode never errors; it just resolves to null when no session is
  // present or public auth isn't configured at all.
  const { user: siteUser } = await requireAuth(req, "none");

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
            return renderErrorPage(
              engine,
              url,
              render,
              500,
              "TSX component not found",
              contentApi,
            );
          }
          return render(
            await resolveTemplateVNode(Component as ComponentType<any>, {
              data,
              site: engine.site,
              config: engine.config,
              ...(await navigationForRequest(
                req,
                engine.router.getNavigation(page.language),
              )),
              translations: engine.router.getTranslations(page.route),
              route: page.route,
              params: {},
              content: contentApi,
              siteUser,
            }),
          );
        },
        /**
         * Same-origin CSRF guard for mutating handlers.
         * Origin, then Sec-Fetch-Site, then Referer — fail-open only when
         * all three are absent (curl / webhooks; SameSite is the backstop).
         */
        csrfCheck: (): Response | null => checkSameOriginCsrf(req, url),
      };
      return methodFn(req, ctx);
    }
    // No handler for this method — fall through to normal rendering.
  }

  const Component = await page.component();
  if (!Component) {
    return renderErrorPage(
      engine,
      url,
      render,
      500,
      "TSX component not found",
      contentApi,
    );
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
        siteUser,
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
    siteUser,
  });

  if (layout) {
    const strings = await engine.themes.loadLocale(page.language ?? "en");
    const t = createTranslator(strings);
    const pageLangForDir = page.language ??
      engine.config?.system?.languages?.default ?? "en";
    return render(
      await resolveTemplateVNode(layout as ComponentType<any>, {
        page,
        pageTitle: buildPageTitle(page, engine.site.title),
        site: engine.site,
        config: engine.config,
        ...(await navigationForRequest(
          req,
          engine.router.getNavigation(page.language),
        )),
        translations: engine.router.getTranslations(page.route),
        pathname: url.pathname,
        search: url.search,
        themeConfig: await resolveThemeConfig(page, engine),
        t,
        dir: directionOf(
          pageLangForDir,
          engine.config?.system?.languages?.rtl_override,
        ),
        children: content,
        content: contentApi,
      }),
    );
  }

  return render(content);
}
