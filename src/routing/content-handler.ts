/** @jsxImportSource preact */
import { h, type ComponentType } from "preact";
import type { DuneEngine } from "../core/engine.ts";
import type { Page } from "../content/types.ts";
import { buildPageTitle } from "../content/types.ts";
import type { CollectionEngine } from "../collections/engine.ts";
import { renderSections } from "../sections/mod.ts";
import type { SectionInstance } from "../sections/mod.ts";
import { directionOf } from "../i18n/rtl.ts";
import { rewriteInternalLinks } from "./link-rewriter.ts";
import { resolveCollectionForPage } from "./collection-resolver.ts";

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
): Promise<Response> {
  const templateName = engine.themes.resolveTemplateName(page) ?? "default";
  const template = await engine.themes.loadTemplate(templateName);

  if (!template) {
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
    ? await resolveCollectionForPage(page, collections, engine)
    : undefined;

  const layout = await engine.themes.loadLayout("layout");
  const strings = await engine.themes.loadLocale(page.language ?? "en");
  const t = (key: string) => (strings[key] ?? key) as string;

  return render(
    h(template.component as ComponentType<any>, {
      page,
      pageTitle: buildPageTitle(page, engine.site.title),
      site: engine.site,
      config: engine.config,
      nav: engine.router.getTopNavigation(page.language),
      pathname: url.pathname,
      search: url.search,
      collection,
      Layout: layout ?? undefined,
      themeConfig: engine.themeConfig,
      t,
      dir: directionOf(pageLang, engine.config?.system?.languages?.rtl_override),
      children: htmlContent,
    }),
  );
}
