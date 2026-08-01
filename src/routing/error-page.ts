/**
 * Themed error page rendering — 404/500 responses routed through the theme.
 *
 * Resolution order:
 *   1. `templates/error.tsx` in the theme chain — receives a synthetic page
 *      whose frontmatter carries `{ statusCode, message }` plus the usual
 *      TemplateProps (site, config, nav, Layout, dir, t, ...).
 *   2. Theme layout wrapping a minimal built-in error body.
 *   3. Bare standalone HTML document (no theme available at all).
 */

/** @jsxImportSource preact */
import { h, type ComponentType } from "preact";
import type { DuneEngine } from "../core/engine.ts";
import type { Page, TemplateProps } from "../content/types.ts";
import { directionOf } from "../i18n/rtl.ts";
import { createTranslator } from "../i18n/translate.ts";
import { resolveTemplateVNode } from "../themes/resolve-template.ts";
import { splitLanguagePrefix } from "./resolver.ts";

const STATUS_TITLES: Record<number, string> = {
  404: "404 — Not Found",
  500: "500 — Server Error",
};

/**
 * Render an error response through the theme's `error` template when one
 * exists, falling back to the built-in layout-wrapped or standalone markup.
 */
export async function renderErrorPage(
  engine: DuneEngine,
  url: URL,
  renderJsx: (jsx: unknown, status?: number) => Response | Promise<Response>,
  statusCode: number,
  message: string,
): Promise<Response> {
  const title = STATUS_TITLES[statusCode] ?? `${statusCode} — Error`;
  const { lang } = splitLanguagePrefix(url.pathname, engine.config?.system?.languages);
  const dir = directionOf(lang, engine.config?.system?.languages?.rtl_override);
  const nav = engine.router.getTopNavigation(lang);
  const navAll = engine.router.getNavigation(lang);
  const translations = engine.router.getTranslations(url.pathname);
  const Layout = await engine.themes.loadLayout("layout");

  const errorPage = {
    route: url.pathname,
    template: "error",
    frontmatter: { title, statusCode, message },
    language: lang,
  } as unknown as Page;

  const errorTemplate = await engine.themes.loadTemplate("error");
  if (errorTemplate) {
    const strings = await engine.themes.loadLocale(lang);
    const t = createTranslator(strings);
    return renderJsx(
      // deno-lint-ignore no-explicit-any
      await resolveTemplateVNode(errorTemplate.component as ComponentType<any>, {
        page: errorPage,
        pageTitle: `${title} | ${engine.site.title}`,
        site: engine.site,
        config: engine.config,
        nav,
        navAll,
        translations,
        pathname: url.pathname,
        search: url.search,
        Layout: Layout ?? undefined,
        themeConfig: engine.themeConfig,
        t,
        dir,
      }),
      statusCode,
    );
  }

  if (Layout) {
    return renderJsx(
      h(Layout as unknown as ComponentType<TemplateProps>, {
        site: engine.site,
        page: errorPage,
        nav,
        pageTitle: title,
        config: engine.config,
        dir,
        t: createTranslator(await engine.themes.loadLocale(lang)),
      },
        h("div", { class: "content-page" },
          h("div", { style: "text-align: center; max-width: 600px; margin: 4rem auto; padding: 2rem;" },
            h("h1", null, String(statusCode)),
            h("p", null, message),
            h("a", { href: "/" }, "← Go home"),
          ),
        ),
      ),
      statusCode,
    );
  }

  return renderJsx(
    h("html", null,
      h("head", null,
        h("title", null, title),
        h("meta", { charset: "utf-8" }),
        h("meta", { name: "viewport", content: "width=device-width, initial-scale=1" }),
        h("style", null, `
          body { font-family: system-ui, sans-serif; max-width: 600px; margin: 4rem auto; padding: 0 1rem; color: #333; }
          h1 { font-size: 3rem; margin-bottom: 0.5rem; }
          p { color: #666; }
          a { color: #0066cc; }
        `),
      ),
      h("body", null,
        h("h1", null, String(statusCode)),
        h("p", null, message, ": ", url.pathname),
        h("a", { href: "/" }, "← Go home"),
      ),
    ),
    statusCode,
  );
}
