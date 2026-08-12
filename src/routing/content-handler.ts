/** @jsxImportSource preact */
import { h, type ComponentType } from "preact";
import type { DuneEngine } from "../core/engine.ts";
import type { Page } from "../content/types.ts";
import { buildPageTitle } from "../content/types.ts";
import type { CollectionEngine } from "../collections/engine.ts";
import { renderSections } from "../sections/mod.ts";
import type { SectionInstance } from "../sections/mod.ts";
import { directionOf } from "../i18n/rtl.ts";
import { createTranslator } from "../i18n/translate.ts";
import { rewriteInternalLinks } from "./link-rewriter.ts";
import { resolveCollectionForPage, resolveCollectionsForPage } from "./collection-resolver.ts";
import { resolveThemeConfig } from "./theme-config-resolver.ts";
import { resolveTemplateVNode } from "../themes/resolve-template.ts";
import { logger } from "../core/logger.ts";

// Dedupe by template name so a broken theme configuration doesn't spam the
// log on every page render — one warning per distinct missing template name
// per process is enough to make the fallback below discoverable, which it
// previously was not at all (see the "dune new never wrote theme:" bug this
// was found alongside).
const warnedMissingTemplates = new Set<string>();

/**
 * Render a Markdown (or MDX) content page with the site theme.
 * Handles collection resolution, page-builder sections, i18n link rewriting,
 * and layout loading.
 */
export async function handleMarkdownPage(
  engine: DuneEngine,
  url: URL,
  page: Page,
  collections: CollectionEngine | undefined,
  render: (jsx: unknown, status?: number) => Response | Promise<Response>,
  requestedPage = 1,
): Promise<Response> {
  const templateName = engine.themes.resolveTemplateName(page) ?? "default";
  const template = await engine.themes.loadTemplate(templateName);

  if (!template) {
    if (!warnedMissingTemplates.has(templateName)) {
      warnedMissingTemplates.add(templateName);
      logger.warn("theme.template.not_found", {
        templateName,
        themeName: engine.config?.theme?.name,
        sourcePath: page.sourcePath,
        reason:
          "Rendering a bare unstyled fallback instead. Check theme.name in " +
          "config/site.yaml and that a matching directory exists under themes/.",
      });
    }
    const html = await page.html();
    return render(
      h("html", null,
        h("head", null,
          h("title", null, buildPageTitle(page, engine.site.title)),
          h("meta", { charset: "utf-8" }),
          h("meta", { name: "viewport", content: "width=device-width, initial-scale=1" }),
          h("style", null, `
            body { font-family: system-ui, sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; line-height: 1.6; color: #333; }
            h1 { margin-bottom: 0.5rem; }
            pre { background: #f5f5f5; padding: 1rem; border-radius: 4px; overflow-x: auto; }
            code { font-family: "SF Mono", Monaco, monospace; font-size: 0.9em; }
            a { color: #0066cc; }
            img { max-width: 100%; }
            table { border-collapse: collapse; width: 100%; }
            th, td { border: 1px solid #ddd; padding: 0.5rem; text-align: left; }
            th { background: #f5f5f5; }
            nav a { margin-right: 1rem; }
          `),
        ),
        h("body", null,
          h("nav", null,
            h("a", { href: "/" }, engine.site.title),
          ),
          h("article", null,
            h("h1", null, page.frontmatter.title),
            h("div", { dangerouslySetInnerHTML: { __html: html } }),
          ),
        ),
      ),
    );
  }

  const supportedLangs = engine.config?.system?.languages?.supported ?? [];
  const defaultLang = engine.config?.system?.languages?.default ?? "en";
  const includeDefaultInUrl = engine.config?.system?.languages?.include_default_in_url ?? false;
  const pageLang = page.language ?? defaultLang;

  let html: string;
  if (page.frontmatter.layout === "page-builder") {
    const sectionData = Array.isArray(page.frontmatter.sections)
      ? (page.frontmatter.sections as SectionInstance[])
      : [];
    html = renderSections(sectionData);
  } else {
    html = await page.html();
    if (supportedLangs.length > 1) {
      html = rewriteInternalLinks(html, pageLang, defaultLang, includeDefaultInUrl, supportedLangs);
    }
  }
  const htmlContent = h("div", { dangerouslySetInnerHTML: { __html: html } });

  const collection = collections
    ? await resolveCollectionForPage(page, collections, engine, requestedPage)
    : undefined;
  const collectionsMap = collections
    ? await resolveCollectionsForPage(page, collections, engine, requestedPage)
    : undefined;
  const themeConfig = await resolveThemeConfig(page, engine);

  const layout = await engine.themes.loadLayout("layout");
  const strings = await engine.themes.loadLocale(page.language ?? "en");
  const t = createTranslator(strings);

  return render(
    await resolveTemplateVNode(template.component as ComponentType<any>, {
      page,
      pageTitle: buildPageTitle(page, engine.site.title),
      site: engine.site,
      config: engine.config,
      nav: engine.router.getTopNavigation(page.language),
      navAll: engine.router.getNavigation(page.language),
      translations: engine.router.getTranslations(page.route),
      pathname: url.pathname,
      search: url.search,
      collection,
      collections: collectionsMap,
      Layout: layout ?? undefined,
      themeConfig,
      t,
      dir: directionOf(pageLang, engine.config?.system?.languages?.rtl_override),
      children: htmlContent,
    }),
  );
}
