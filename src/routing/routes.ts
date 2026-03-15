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
import type { Collection, MediaFile, TemplateComponent } from "../content/types.ts";
import { buildPageTitle } from "../content/types.ts";
import type { CollectionEngine } from "../collections/engine.ts";
import type { FlexEngine } from "../flex/engine.ts";
import type { FlexRecord, FlexSchema } from "../flex/types.ts";
import type { SearchEngine } from "../search/engine.ts";
import { createSearchAnalytics } from "../search/analytics.ts";
import { generateSearchPage } from "../search/page.ts";

/**
 * Props passed to a flex type list template.
 * Convention: `themes/{theme}/templates/flex/{type}-list.tsx`
 * Fallback:   `themes/{theme}/templates/flex/list.tsx`
 */
export interface FlexListTemplateProps {
  type: string;
  schema: FlexSchema;
  records: FlexRecord[];
  site: DuneEngine["site"];
  config: DuneEngine["config"];
  nav: ReturnType<DuneEngine["router"]["getTopNavigation"]>;
  pathname: string;
  Layout?: TemplateComponent;
  t: (key: string) => string;
}

/**
 * Props passed to a flex record detail template.
 * Convention: `themes/{theme}/templates/flex/{type}.tsx`
 * Fallback:   `themes/{theme}/templates/flex/detail.tsx`
 */
export interface FlexDetailTemplateProps {
  type: string;
  schema: FlexSchema;
  record: FlexRecord;
  site: DuneEngine["site"];
  config: DuneEngine["config"];
  nav: ReturnType<DuneEngine["router"]["getTopNavigation"]>;
  pathname: string;
  Layout?: TemplateComponent;
  t: (key: string) => string;
}

/**
 * Register all Dune routes on a Fresh App.
 * Returns a function that takes the app and returns it with routes added.
 */
export function duneRoutes(
  engine: DuneEngine,
  collections?: CollectionEngine,
  flex?: FlexEngine,
  search?: SearchEngine,
  analyticsPath?: string,
) {
  // Analytics recorder — only created when a path is provided
  const analytics = analyticsPath ? createSearchAnalytics(analyticsPath) : null;
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

      // Uint8Array<ArrayBufferLike> is a valid BodyInit at runtime, but
      // TypeScript 5.7's generic typed-array signature requires an explicit
      // cast here.  A single cast (not double `as unknown as BodyInit`) is
      // sufficient and documents the intent clearly.
      return new Response(media.data as BodyInit, {
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

      // GET /api/search/suggest — autocomplete suggestions
      if (path === "/api/search/suggest") {
        const q = url.searchParams.get("q") ?? "";
        const suggestions = search ? search.suggest(q, 10) : [];
        return Response.json({ suggestions });
      }

      // GET /api/search — faceted full-text search
      if (path === "/api/search") {
        if (!search) {
          return Response.json({ items: [], total: 0, query: "", filters: {} });
        }

        const q = url.searchParams.get("q") ?? "";
        const filterTemplate = url.searchParams.get("template");
        const filterPublished = url.searchParams.get("published");
        const filterLang = url.searchParams.get("lang");
        const filterFrom = url.searchParams.get("from");
        const filterTo = url.searchParams.get("to");
        const limit = Math.min(
          parseInt(url.searchParams.get("limit") ?? "20"),
          100,
        );

        // Collect taxonomy filters: taxonomy[category][]=news&taxonomy[tag][]=deno
        const taxonomyFilters: Record<string, string[]> = {};
        for (const [key, value] of url.searchParams.entries()) {
          const match = key.match(/^taxonomy\[([^\]]+)\]\[\]$/);
          if (match) {
            const taxName = match[1];
            if (!taxonomyFilters[taxName]) taxonomyFilters[taxName] = [];
            taxonomyFilters[taxName].push(value);
          }
        }

        // Fetch a larger candidate set then filter down
        const raw = search.search(q, 200);

        const filtered = raw.filter(({ page: p }) => {
          if (filterTemplate && p.template !== filterTemplate) return false;
          if (filterPublished !== null && String(p.published) !== filterPublished) return false;
          if (filterLang && p.language !== filterLang) return false;
          if (filterFrom && p.date && p.date < filterFrom) return false;
          if (filterTo && p.date && p.date > filterTo) return false;
          for (const [taxName, vals] of Object.entries(taxonomyFilters)) {
            const pageVals = p.taxonomy[taxName] ?? [];
            if (!vals.some((v) => pageVals.includes(v))) return false;
          }
          return true;
        });

        const resultCount = filtered.length;
        const items = filtered.slice(0, limit).map(({ page: p, score, excerpt }) => ({
          route: p.route,
          title: p.title,
          template: p.template,
          date: p.date,
          taxonomy: p.taxonomy,
          score,
          excerpt,
        }));

        // Fire-and-forget analytics recording
        if (analytics && q.trim()) {
          analytics.record({ query: q.trim(), resultCount, timestamp: Date.now() }).catch(
            () => {},
          );
        }

        return Response.json({
          items,
          total: resultCount,
          query: q,
          filters: {
            template: filterTemplate ?? undefined,
            published: filterPublished ?? undefined,
            lang: filterLang ?? undefined,
            from: filterFrom ?? undefined,
            to: filterTo ?? undefined,
            taxonomy: Object.keys(taxonomyFilters).length ? taxonomyFilters : undefined,
          },
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

      // ── Search route ──────────────────────────────────────────────────────
      // Intercept /search before content resolution so it is always served,
      // even when there is no content file at that path.
      if (url.pathname === "/search") {
        const q = url.searchParams.get("q") ?? "";
        const rawResults = search ? search.search(q, 20) : [];
        const results = rawResults.map((r) => ({
          route: r.page.route,
          title: r.page.title,
          excerpt: r.excerpt,
          score: r.score,
        }));

        // Try theme's "search" template first
        const searchTemplate = await engine.themes.loadTemplate("search");
        if (searchTemplate) {
          const layout = await engine.themes.loadLayout("layout");
          const strings = await engine.themes.loadLocale("en");
          const t = (key: string) => (strings[key] ?? key) as string;
          return renderJsx(
            h(searchTemplate.component as ComponentType<any>, {
              page: null,
              pageTitle: `Search${q ? `: ${q}` : ""} | ${engine.site.title}`,
              site: engine.site,
              config: engine.config,
              nav: engine.router.getTopNavigation("en"),
              pathname: url.pathname,
              search: url.search,
              Layout: layout ?? undefined,
              themeConfig: engine.themeConfig,
              t,
              searchQuery: q,
              searchResults: results,
            }),
          );
        }

        // Fallback: standalone search page (no theme template available)
        const html = generateSearchPage({
          query: q,
          results,
          site: engine.site,
          siteUrl: engine.site.url || "",
        });
        return new Response(html, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      // ─────────────────────────────────────────────────────────────────────

      // ── Flex Object public routes ─────────────────────────────────────────
      // /flex/{type}       → list view   (template: flex/{type}-list or flex/list)
      // /flex/{type}/{id}  → detail view (template: flex/{type}    or flex/detail)
      if (flex && url.pathname.startsWith("/flex/")) {
        const parts = url.pathname.split("/").filter(Boolean); // ["flex", type, ...id]
        if (parts.length >= 2) {
          const flexType = decodeURIComponent(parts[1]);
          const schemas = await flex.loadSchemas();
          const schema = schemas[flexType];
          if (!schema) {
            return renderJsx(
              h("div", null, `Flex type "${flexType}" not found`),
              404,
            );
          }
          const strings = await engine.themes.loadLocale("en");
          const t = (key: string) => (strings[key] ?? key) as string;
          const layout = await engine.themes.loadLayout("layout");
          const nav = engine.router.getTopNavigation("en");
          const baseProps = {
            type: flexType,
            schema,
            site: engine.site,
            config: engine.config,
            nav,
            pathname: url.pathname,
            Layout: layout ?? undefined,
            t,
          };

          if (parts.length === 2) {
            // List view
            const records = await flex.list(flexType);
            const templateNames = [`flex/${flexType}-list`, "flex/list"];
            let template = null;
            for (const name of templateNames) {
              template = await engine.themes.loadTemplate(name);
              if (template) break;
            }
            if (!template) {
              // Auto-generated list fallback
              return renderJsx(
                h("html", null,
                  h("head", null,
                    h("title", null, schema.title),
                    h("meta", { charset: "utf-8" }),
                    h("meta", { name: "viewport", content: "width=device-width, initial-scale=1" }),
                    h("style", null, "body{font-family:system-ui,sans-serif;max-width:900px;margin:2rem auto;padding:0 1rem}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:.5rem;text-align:left}th{background:#f5f5f5}a{color:#0066cc}"),
                  ),
                  h("body", null,
                    h("h1", null, `${schema.icon ?? ""} ${schema.title}`),
                    schema.description ? h("p", null, schema.description) : null,
                    records.length === 0
                      ? h("p", null, "No records yet.")
                      : h("table", null,
                          h("thead", null,
                            h("tr", null, ...Object.keys(schema.fields).slice(0, 4).map((f) =>
                              h("th", { key: f }, schema.fields[f].label ?? f)
                            )),
                          ),
                          h("tbody", null, ...records.map((r) =>
                            h("tr", { key: r._id },
                              ...Object.keys(schema.fields).slice(0, 4).map((f) =>
                                h("td", { key: f },
                                  h("a", { href: `/flex/${flexType}/${r._id}` },
                                    f === Object.keys(schema.fields)[0]
                                      ? String(r[f] ?? r._id)
                                      : String(r[f] ?? "")
                                  )
                                )
                              )
                            )
                          )),
                        ),
                  ),
                ),
              );
            }
            return renderJsx(
              h(template.component as unknown as ComponentType<FlexListTemplateProps>, {
                ...baseProps,
                records,
              }),
            );
          }

          if (parts.length === 3) {
            // Detail view
            const recordId = decodeURIComponent(parts[2]);
            const record = await flex.get(flexType, recordId);
            if (!record) {
              return renderJsx(
                h("div", null, `Record "${recordId}" not found`),
                404,
              );
            }
            const templateNames = [`flex/${flexType}`, "flex/detail"];
            let template = null;
            for (const name of templateNames) {
              template = await engine.themes.loadTemplate(name);
              if (template) break;
            }
            if (!template) {
              // Auto-generated detail fallback
              const title = String((record.name ?? record.title ?? record._id) as string);
              return renderJsx(
                h("html", null,
                  h("head", null,
                    h("title", null, `${title} — ${schema.title}`),
                    h("meta", { charset: "utf-8" }),
                    h("meta", { name: "viewport", content: "width=device-width, initial-scale=1" }),
                    h("style", null, "body{font-family:system-ui,sans-serif;max-width:800px;margin:2rem auto;padding:0 1rem}dl{display:grid;grid-template-columns:auto 1fr;gap:.5rem 1rem}dt{font-weight:600;color:#555}dd{margin:0}a{color:#0066cc}"),
                  ),
                  h("body", null,
                    h("p", null, h("a", { href: `/flex/${flexType}` }, `← All ${schema.title}`)),
                    h("h1", null, title),
                    h("dl", null,
                      ...Object.entries(record)
                        .filter(([k]) => !k.startsWith("_"))
                        .flatMap(([k, v]) => [
                          h("dt", { key: `dt-${k}` }, schema.fields[k]?.label ?? k),
                          h("dd", { key: `dd-${k}` }, String(Array.isArray(v) ? v.join(", ") : v ?? "")),
                        ])
                    ),
                  ),
                ),
              );
            }
            return renderJsx(
              h(template.component as unknown as ComponentType<FlexDetailTemplateProps>, {
                ...baseProps,
                record,
              }),
            );
          }
        }
      }
      // ─────────────────────────────────────────────────────────────────────

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
              themeConfig: engine.themeConfig,
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
          themeConfig: engine.themeConfig,
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
