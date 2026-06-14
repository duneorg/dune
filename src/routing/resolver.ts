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
import { effectiveOrder } from "../content/path-utils.ts";

/** Result of {@link RouteResolver.resolve} — matched page or redirect. */
export interface RouteMatch {
  type: "page" | "redirect";
  /** The matched PageIndex (only for type="page") */
  page?: PageIndex;
  /** Redirect target URL (only for type="redirect") */
  redirectTo?: string;
}

/** Options for {@link createRouteResolver}. */
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

/** Maps URL pathnames to page indexes. Obtain via {@link createRouteResolver}. */
export interface RouteResolver {
  resolve(pathname: string): RouteMatch | null;
  findBySourcePath(sourcePath: string): PageIndex | undefined;
  getNavigation(lang?: string): PageIndex[];
  getTopNavigation(lang?: string): PageIndex[];
  rebuild(pages: PageIndex[], newHomeSlug?: string): void;
}

/**
 * Create a route resolver from page indexes and site config.
 */
export function createRouteResolver(options: RouteResolverOptions): RouteResolver {
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

  // Resolve the home page from homeSlug.
  // The home page is typically a page-folder, so its route will carry a trailing
  // slash ("/home/"). We try both forms to handle all configurations.
  function findHomeBySlug(slug: string, lang: string): PageIndex | null {
    const noSlash = normalizeRoute("/" + slug);
    const withSlash = noSlash === "/" ? "/" : noSlash + "/";
    if (isMultilingual) {
      return findPage(noSlash, lang) ?? findPage(withSlash, lang) ?? null;
    }
    return routeMap.get(noSlash) ?? routeMap.get(withSlash) ?? null;
  }

  let homePage: PageIndex | null = findHomeBySlug(options.homeSlug, defaultLang);

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
        } else if (first && includeDefaultInUrl && first === defaultLang) {
          lang = defaultLang;
          route = "/" + segments.slice(1).join("/") || "/";
        }
      }

      // 2. Home page: map "/" to the configured/autodetected home page
      if ((route === "/" || route === "") && homePage) {
        if (isMultilingual) {
          const page = findHomeBySlug(options.homeSlug, lang);
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

      // 5. Best-effort canonical redirect (both directions).
      // Request arrived at the wrong slash form — redirect to the canonical URL
      // of the page that actually exists at the other form. Only fires when the
      // other form exists; neither form existing produces a 404 (no speculation).
      {
        const otherForm = route.endsWith("/") && route.length > 1
          ? route.slice(0, -1)
          : route + "/";
        const otherMatch = isMultilingual ? findPage(otherForm, lang) : routeMap.get(otherForm);
        if (otherMatch) {
          const redirectTo = isMultilingual && lang !== defaultLang
            ? "/" + lang + otherMatch.route
            : otherMatch.route;
          return { type: "redirect", redirectTo };
        }
      }

      // 6. Legacy URL normalization: replace + with - (URLs from older CMS systems like Antville)
      //    Handles both literal + and percent-encoded %2b (normalizeRoute guarantees lowercase).
      //    Only activates when the dashed equivalent exists in the route map.
      if (route.includes("+") || route.includes("%2b")) {
        const dashed = route
          .replace(/%2b/g, "-")   // percent-encoded +
          .replace(/\+/g, "-")    // literal +
          .replace(/-{2,}/g, "-");
        // Try both slash forms — the legacy URL may carry a trailing slash that
        // doesn't match the canonical route key.
        const dashedOther = dashed.endsWith("/") && dashed.length > 1
          ? dashed.slice(0, -1)
          : dashed + "/";
        const legacyMatch = isMultilingual
          ? (findPage(dashed, lang) ?? findPage(dashedOther, lang))
          : (routeMap.get(dashed) ?? routeMap.get(dashedOther));
        if (legacyMatch) {
          // Redirect to the canonical route (not the computed dashed string, which
          // may carry a trailing slash from the original URL).
          const redirectTo = isMultilingual && lang !== defaultLang
            ? "/" + lang + legacyMatch.route
            : legacyMatch.route;
          return { type: "redirect", redirectTo };
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
        if (a.order !== b.order) return effectiveOrder(a.order) - effectiveOrder(b.order);
        return a.route.localeCompare(b.route);
      });
    },

    /**
     * Get top-level navigation items (depth 0 = direct children of content root).
     */
    getTopNavigation(lang?: string): PageIndex[] {
      return this.getNavigation(lang).filter((p: PageIndex) => p.depth === 0);
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
      homePage = findHomeBySlug(options.homeSlug, defaultLang);
    },
  };
}

/**
 * Normalize a route for consistent lookup.
 * Ensures leading slash, lowercase, no double slashes.
 * Trailing slash is preserved — page-folder routes end with "/" and flat-file
 * routes do not. The resolver uses this distinction to enforce canonical form.
 */
function normalizeRoute(route: string): string {
  let normalized = route.toLowerCase().trim();

  // Ensure leading slash
  if (!normalized.startsWith("/")) {
    normalized = "/" + normalized;
  }

  // Collapse double slashes
  normalized = normalized.replace(/\/+/g, "/");

  return normalized;
}

