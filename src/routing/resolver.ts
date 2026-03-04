/**
 * Route resolver — maps URLs to PageIndex entries.
 *
 * Resolution order (per PRD §7.2):
 *   1. Check site-level redirects (exact match) → 301
 *   2. Check route aliases (from page frontmatter)
 *   3. Check content index for direct route match
 *   4. Check site-level route aliases (regex patterns)
 *   5. 404
 *
 * The resolver only works with the lightweight PageIndex — no page
 * loading happens here. That's the page loader's job.
 */

import type { SiteConfig } from "../config/types.ts";
import type { PageIndex } from "../content/types.ts";

export interface RouteMatch {
  type: "page" | "redirect";
  /** The matched PageIndex (only for type="page") */
  page?: PageIndex;
  /** Redirect target URL (only for type="redirect") */
  redirectTo?: string;
}

export interface RouteResolverOptions {
  /** All page indexes from the content index */
  pages: PageIndex[];
  /** Site config for redirects and route aliases */
  site: SiteConfig;
  /** Folder slug that maps to "/" (from config or autodetect) */
  homeSlug: string;
  /** Supported language codes (when length > 1, enables /{lang}/path routing) */
  supportedLanguages?: string[];
  /** Default language for path without prefix */
  defaultLanguage?: string;
  /** If true, default language also appears in URL (/en/page) */
  includeDefaultInUrl?: boolean;
}

/**
 * Create a route resolver from page indexes and site config.
 */
export function createRouteResolver(options: RouteResolverOptions) {
  const supportedLangs = options.supportedLanguages ?? [];
  const defaultLang = options.defaultLanguage ?? "en";
  const includeDefaultInUrl = options.includeDefaultInUrl ?? false;
  const isMultilingual = supportedLangs.length > 1;

  // Build lookup: route|lang -> PageIndex (when multilingual) or route -> PageIndex (single lang)
  const routeMap = new Map<string, PageIndex>();
  const aliasMap = new Map<string, PageIndex>();

  function routeLangKey(route: string, lang: string): string {
    return normalizeRoute(route) + "|" + lang.toLowerCase();
  }

  function findPage(route: string, lang: string): PageIndex | undefined {
    const key = routeLangKey(route, lang);
    const match = routeMap.get(key);
    if (match) return match;
    // Fallback to default language if requested lang not found
    if (lang !== defaultLang) {
      return routeMap.get(routeLangKey(route, defaultLang));
    }
    return undefined;
  }

  // Index all pages by route (and route+lang when multilingual)
  for (const page of options.pages) {
    if (!page.routable) continue;
    if (!page.published) continue;
    if (page.status && page.status !== "published") continue;

    const route = normalizeRoute(page.route);
    if (isMultilingual) {
      routeMap.set(routeLangKey(route, page.language), page);
    } else {
      routeMap.set(route, page);
    }
  }

  // Resolve the home page from homeSlug
  const homeRoute = normalizeRoute("/" + options.homeSlug);
  let homePage: PageIndex | null = null;
  if (isMultilingual) {
    homePage = findPage(homeRoute, defaultLang) ?? null;
  } else {
    homePage = routeMap.get(homeRoute) ?? null;
  }

  return {
    /**
     * Resolve a URL pathname to a route match.
     */
    resolve(pathname: string): RouteMatch | null {
      const normalized = normalizeRoute(pathname);

      // 1. Check site-level redirects
      const redirectTarget = options.site.redirects[pathname] ??
        options.site.redirects[normalized];
      if (redirectTarget) {
        return { type: "redirect", redirectTo: redirectTarget };
      }

      let route = normalized;
      let lang = defaultLang;

      if (isMultilingual) {
        const segments = normalized.split("/").filter(Boolean);
        const first = segments[0]?.toLowerCase();
        if (first && supportedLangs.includes(first)) {
          lang = first;
          route = "/" + segments.slice(1).join("/") || "/";
          // "/de" with nothing after -> home route
          if (route === "/" && segments.length === 1) {
            route = homeRoute;
          }
        } else if (first && includeDefaultInUrl && first === defaultLang) {
          lang = defaultLang;
          route = "/" + segments.slice(1).join("/") || "/";
          if (route === "/" && segments.length === 1) {
            route = homeRoute;
          }
        }
      }

      // 2. Home page: map "/" to the configured/autodetected home page
      if ((route === "/" || route === "") && homePage) {
        if (isMultilingual) {
          const page = findPage(homeRoute, lang);
          return page ? { type: "page", page } : null;
        }
        return { type: "page", page: homePage };
      }

      // 3. Check route aliases from site config
      const aliasTarget = options.site.routes[pathname] ??
        options.site.routes[normalized];
      if (aliasTarget) {
        const aliasRoute = normalizeRoute(aliasTarget);
        const aliasPage = isMultilingual
          ? findPage(aliasRoute, lang)
          : routeMap.get(aliasRoute);
        if (aliasPage) {
          return { type: "page", page: aliasPage };
        }
      }

      // 4. Direct route match
      const directMatch = isMultilingual
        ? findPage(route, lang)
        : routeMap.get(route);
      if (directMatch) {
        return { type: "page", page: directMatch };
      }

      // 5. Try with/without trailing slash
      if (route.endsWith("/") && route.length > 1) {
        const withoutSlash = route.slice(0, -1);
        const match = isMultilingual ? findPage(withoutSlash, lang) : routeMap.get(withoutSlash);
        if (match) return { type: "page", page: match };
      } else if (route !== "/") {
        const withSlash = route + "/";
        const match = isMultilingual ? findPage(withSlash, lang) : routeMap.get(withSlash);
        if (match) return { type: "page", page: match };
      }

      // 6. Legacy URL normalization: replace + with - (URLs from older CMS systems like Antville)
      //    Handles both literal + and percent-encoded %2b (normalizeRoute guarantees lowercase).
      //    Only activates when the dashed equivalent exists in the route map.
      if (route.includes("+") || route.includes("%2b")) {
        const dashed = route
          .replace(/%2b/g, "-")   // percent-encoded +
          .replace(/\+/g, "-")    // literal +
          .replace(/-{2,}/g, "-");
        const legacyMatch = isMultilingual
          ? findPage(dashed, lang)
          : routeMap.get(dashed);
        if (legacyMatch) {
          return { type: "redirect", redirectTo: dashed };
        }
      }

      return null;
    },

    /**
     * Find a page by its source path (for internal lookups).
     */
    findBySourcePath(sourcePath: string): PageIndex | undefined {
      return options.pages.find((p) => p.sourcePath === sourcePath);
    },

    /**
     * Get all visible, published pages in navigation order.
     * When multilingual, pass lang to filter to that language (avoids duplicate routes).
     */
    getNavigation(lang?: string): PageIndex[] {
      let items = options.pages.filter(
        (p) => p.visible && p.published && p.routable && !p.isModule,
      );
      if (isMultilingual && lang) {
        items = items.filter((p) => p.language === lang);
      }
      return items.sort((a, b) => {
        if (a.depth !== b.depth) return a.depth - b.depth;
        if (a.order !== b.order) return a.order - b.order;
        return a.route.localeCompare(b.route);
      });
    },

    /**
     * Get top-level navigation items (depth 0 = direct children of content root).
     */
    getTopNavigation(lang?: string): PageIndex[] {
      return this.getNavigation(lang).filter((p) => p.depth === 0);
    },

    /**
     * Rebuild lookup maps (call after content index changes).
     */
    rebuild(pages: PageIndex[], newHomeSlug?: string) {
      options.pages = pages;
      if (newHomeSlug !== undefined) {
        options.homeSlug = newHomeSlug;
      }
      routeMap.clear();
      aliasMap.clear();
      for (const page of pages) {
        if (!page.routable || !page.published) continue;
        if (page.status && page.status !== "published") continue;
        const route = normalizeRoute(page.route);
        if (isMultilingual) {
          routeMap.set(routeLangKey(route, page.language), page);
        } else {
          routeMap.set(route, page);
        }
      }
      const newHomeRoute = normalizeRoute("/" + options.homeSlug);
      homePage = isMultilingual
        ? findPage(newHomeRoute, defaultLang) ?? null
        : routeMap.get(newHomeRoute) ?? null;
    },
  };
}

/**
 * Normalize a route for consistent lookup.
 * Ensures leading slash, lowercase, no double slashes.
 */
function normalizeRoute(route: string): string {
  let normalized = route.toLowerCase().trim();

  // Ensure leading slash
  if (!normalized.startsWith("/")) {
    normalized = "/" + normalized;
  }

  // Remove trailing slash (except for root)
  if (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }

  // Collapse double slashes
  normalized = normalized.replace(/\/+/g, "/");

  return normalized;
}

export type RouteResolver = ReturnType<typeof createRouteResolver>;
