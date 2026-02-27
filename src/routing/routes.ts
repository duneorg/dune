/**
 * Fresh route registration — hooks the DuneEngine into Fresh 2.
 *
 * Registers:
 *   - /content-media/* → co-located media serving
 *   - /api/* → REST API endpoints (basic for v0.1)
 *   - /* → catch-all content route (must be last)
 *
 * Per PRD §7.1, template resolution is format-aware:
 *   - .md pages → rendered HTML injected into theme template
 *   - .tsx pages → component renders itself, optionally wrapped in layout
 */

/** @jsxImportSource preact */
import { h, type ComponentType } from "preact";
import type { DuneEngine } from "../core/engine.ts";
import type { Collection, MediaFile } from "../content/types.ts";
import { buildPageTitle } from "../content/types.ts";
import type { CollectionEngine } from "../collections/engine.ts";

/**
 * Register all Dune routes on a Fresh App.
 * Returns a function that takes the app and returns it with routes added.
 */
export function duneRoutes(engine: DuneEngine, collections?: CollectionEngine) {
  return {
    /**
     * Register media serving route.
     */
    mediaHandler: async (req: Request): Promise<Response> => {
      const url = new URL(req.url);
      // Strip /content-media/ prefix
      const mediaPath = url.pathname.replace(/^\/content-media\//, "");

      const media = await engine.serveMedia(mediaPath);
      if (!media) {
        return new Response("Not found", { status: 404 });
      }

      return new Response(media.data, {
        headers: {
          "Content-Type": media.contentType,
          "Content-Length": String(media.size),
          "Cache-Control": "public, max-age=3600",
        },
      });
    },

    /**
     * Handle API requests (basic v0.1: list pages, get page).
     */
    apiHandler: async (req: Request): Promise<Response> => {
      const url = new URL(req.url);
      const path = url.pathname;

      // GET /api/pages — list all pages
      if (path === "/api/pages") {
        const limit = parseInt(url.searchParams.get("limit") ?? "20");
        const offset = parseInt(url.searchParams.get("offset") ?? "0");
        const template = url.searchParams.get("template");

        let items = engine.pages
          .filter((p) => p.published && p.routable)
          .filter((p) => !template || p.template === template);

        const total = items.length;
        items = items.slice(offset, offset + limit);

        return Response.json({
          items: items.map((p) => ({
            route: p.route,
            title: p.title,
            date: p.date,
            template: p.template,
            format: p.format,
            published: p.published,
            taxonomy: p.taxonomy,
          })),
          total,
          limit,
          offset,
        });
      }

      // GET /api/pages/* — get single page
      if (path.startsWith("/api/pages/")) {
        const route = path.replace("/api/pages", "");
        const result = await engine.resolve(route);

        if (result.type !== "page" || !result.page) {
          return Response.json({ error: "Page not found" }, { status: 404 });
        }

        const page = result.page;
        const html = await page.html();

        return Response.json({
          route: page.route,
          title: page.frontmatter.title,
          date: page.frontmatter.date,
          template: page.template,
          format: page.format,
          html,
          frontmatter: page.frontmatter,
          media: page.media.map((m) => ({
            name: m.name,
            url: m.url,
            type: m.type,
          })),
        });
      }

      // GET /api/taxonomy/:name — list taxonomy values
      if (path.startsWith("/api/taxonomy/")) {
        const name = path.replace("/api/taxonomy/", "").split("/")[0];
        const values = engine.taxonomyMap[name];

        if (!values) {
          return Response.json({ error: "Taxonomy not found" }, { status: 404 });
        }

        // Count pages per value
        const counts: Record<string, number> = {};
        for (const [value, sourcePaths] of Object.entries(values)) {
          counts[value] = sourcePaths.length;
        }

        return Response.json({ name, values: counts });
      }

      return Response.json({ error: "Not found" }, { status: 404 });
    },

    /**
     * Catch-all content handler.
     * Resolves URL → page → renders with template or component.
     */
    contentHandler: async (
      req: Request,
      renderJsx: (jsx: unknown, status?: number) => Response,
    ): Promise<Response> => {
      const url = new URL(req.url);
      const result = await engine.resolve(url.pathname);

      // Handle redirects
      if (result.type === "redirect" && result.redirectTo) {
        return Response.redirect(
          new URL(result.redirectTo, url.origin).toString(),
          301,
        );
      }

      // Not found
      if (result.type === "not-found" || !result.page) {
        return renderJsx(
          h("html", null,
            h("head", null,
              h("title", null, "404 — Not Found"),
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
              h("h1", null, "404"),
              h("p", null, "Page not found: ", url.pathname),
              h("a", { href: "/" }, "← Go home"),
            ),
          ),
          404,
        );
      }

      const page = result.page;

      // Format-aware rendering
      if (page.format === "tsx") {
        // TSX pages render themselves
        const Component = await page.component();
        if (!Component) {
          return new Response("TSX component not found", { status: 500 });
        }

        // Layout wrapping
        const layoutName = page.frontmatter.layout;
        if (layoutName === false) {
          // No layout — component provides full HTML
          return renderJsx(
            h(Component as ComponentType<any>, {
              site: engine.site,
              config: engine.config,
              media: createMediaHelper(page.media),
              params: {},
            }),
          );
        }

        // Wrap in layout
        const layout = await engine.themes.loadLayout(
          typeof layoutName === "string" ? layoutName : "default",
        );

        const content = h(Component as ComponentType<any>, {
          site: engine.site,
          config: engine.config,
          media: createMediaHelper(page.media),
          params: {},
        });

        if (layout) {
          const strings = await engine.themes.loadLocale(page.language ?? "en");
          const t = (key: string) => (strings[key] ?? key) as string;
          return renderJsx(
            h(layout as ComponentType<any>, {
              page,
              pageTitle: buildPageTitle(page, engine.site.title),
              site: engine.site,
              config: engine.config,
              nav: engine.router.getTopNavigation(page.language),
              pathname: url.pathname,
              search: url.search,
              t,
              children: content,
            }),
          );
        }

        // No layout found — render content directly
        return renderJsx(content);
      }

      // Markdown pages — render with theme template
      const templateName = engine.themes.resolveTemplateName(page) ?? "default";
      const template = await engine.themes.loadTemplate(templateName);

      if (!template) {
        // Fallback: render markdown HTML directly with minimal page shell
        const html = await page.html();
        return renderJsx(
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

      // Pre-resolve HTML and pass as children to the template
      let html = await page.html();
      const supportedLangs = engine.config?.system?.languages?.supported ?? [];
      const defaultLang = engine.config?.system?.languages?.default ?? "en";
      const includeDefaultInUrl = engine.config?.system?.languages?.include_default_in_url ?? false;
      const pageLang = page.language ?? defaultLang;
      if (supportedLangs.length > 1) {
        html = rewriteInternalLinks(html, pageLang, defaultLang, includeDefaultInUrl, supportedLangs);
      }
      const htmlContent = h("div", { dangerouslySetInnerHTML: { __html: html } });

      // Load collection if page defines one
      let collection: Collection | undefined = undefined;
      if (collections && page.frontmatter.collection) {
        const collectionDef = page.frontmatter.collection;
        // Find the PageIndex for this page to use as context
        const pageIndex = engine.pages.find(p => p.sourcePath === page.sourcePath);
        if (pageIndex) {
          collection = await collections.resolve(collectionDef, pageIndex);
          // Pre-load collection items by calling the async load() method
          // This ensures items are loaded before template rendering (SSR)
          if (collection && typeof collection.load === 'function') {
            await collection.load();
          }
        }
      }

      // Load layout dynamically so it gets ?v=N cache busting on hot-reload.
      // Templates receive it as a prop instead of using a static import.
      const layout = await engine.themes.loadLayout("layout");
      const strings = await engine.themes.loadLocale(page.language ?? "en");
      const t = (key: string) => (strings[key] ?? key) as string;

      return renderJsx(
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
          t,
          children: htmlContent,
        }),
      );
    },
  };
}

/**
 * Rewrite internal links in HTML to include language prefix when needed.
 * E.g. /contact → /de/contact when rendering a German page.
 */
function rewriteInternalLinks(
  html: string,
  lang: string,
  defaultLang: string,
  includeDefaultInUrl: boolean,
  supportedLangs: string[],
): string {
  const needsPrefix = lang !== defaultLang || includeDefaultInUrl;
  if (!needsPrefix) return html;

  const langPrefix = `/${lang}`;
  const skipPrefixes = ["/themes/", "/content-media/", "/api/", "/admin/", "//", "mailto:", "tel:"];
  const hasLangPrefix = new RegExp(`^/(${supportedLangs.join("|")})(/|$)`);

  return html.replace(
    /href="(\/[^"]*)"/g,
    (_, path: string) => {
      if (hasLangPrefix.test(path)) return `href="${path}"`;
      if (skipPrefixes.some((p) => path.startsWith(p))) return `href="${path}"`;
      if (path.includes(":")) return `href="${path}"`;
      const newPath = path === "/" ? langPrefix : `${langPrefix}${path}`;
      return `href="${newPath}"`;
    },
  );
}

/**
 * Build a MediaHelper from a page's media files.
 */
function createMediaHelper(media: MediaFile[]) {
  return {
    url: (filename: string) => {
      const file = media.find((m) => m.name === filename);
      return file?.url ?? "";
    },
    get: (filename: string) => media.find((m) => m.name === filename) ?? null,
    list: () => media,
  };
}
