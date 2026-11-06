/**
 * Themed login page: `GET /auth/login` through the theme's `login` template.
 *
 * `templates/login.tsx` in the theme chain receives a synthetic page whose
 * frontmatter carries the {@link LoginView} (the same pattern as
 * `templates/error.tsx` and its `{ statusCode, message }`) plus the usual
 * template props (site, config, nav, Layout, dir, t, ...). A theme without the
 * template gets `null` here and the caller serves the built-in page.
 *
 * @module
 */

import type { ComponentType } from "preact";
import type { DuneEngine } from "../core/engine.ts";
import type { Page } from "../content/types.ts";
import type { ContentApi } from "../content/api.ts";
import type { LoginView, RenderJsx } from "../auth/routes.ts";
import { directionOf } from "../i18n/rtl.ts";
import { createTranslator } from "../i18n/translate.ts";
import { resolveTemplateVNode } from "../themes/resolve-template.ts";
import { splitLanguagePrefix } from "./resolver.ts";
import { navigationForRequest } from "../auth/gating.ts";

/** Render the theme's `login` template, or resolve `null` when the theme has none. */
export async function renderLoginPage(
  engine: DuneEngine,
  req: Request,
  view: LoginView,
  renderJsx: RenderJsx,
  status: number,
  contentApi?: ContentApi,
): Promise<Response | null> {
  const template = await engine.themes.loadTemplate("login");
  if (!template) return null;

  const url = new URL(req.url);
  const { lang } = splitLanguagePrefix(url.pathname, engine.config?.system?.languages);
  const dir = directionOf(lang, engine.config?.system?.languages?.rtl_override);
  const { nav, navAll } = await navigationForRequest(req, engine.router.getNavigation(lang));
  const Layout = await engine.themes.loadLayout("layout");
  const t = createTranslator(await engine.themes.loadLocale(lang));
  const title = "Log in";

  const page = {
    route: url.pathname,
    template: "login",
    frontmatter: { title, ...view },
    language: lang,
  } as unknown as Page;

  return await renderJsx(
    // deno-lint-ignore no-explicit-any
    await resolveTemplateVNode(template.component as ComponentType<any>, {
      page,
      pageTitle: `${title} | ${engine.site.title}`,
      site: engine.site,
      config: engine.config,
      nav,
      navAll,
      translations: engine.router.getTranslations(url.pathname),
      pathname: url.pathname,
      search: url.search,
      Layout: Layout ?? undefined,
      themeConfig: engine.themeConfig,
      t,
      dir,
      content: contentApi,
    }),
    status,
  );
}
