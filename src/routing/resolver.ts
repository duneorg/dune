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
}

/**
 * Create a route resolver from page indexes and site config.
 */
export function createRouteResolver(options: RouteResolverOptions) {
  // Build lookup maps for fast resolution
  const routeMap = new Map<string, PageIndex>();
  const aliasMap = new Map<string, PageIndex>();

  // Index all pages by route and their aliases
  for (const page of options.pages) {
    if (!page.routable) continue;
    if (!page.published) continue;
    // Only published status pages are publicly routable
    if (page.status && page.status !== "published") continue;

    routeMap.set(normalizeRoute(page.route), page);

    // Index frontmatter route aliases
    // (We'd need to look these up from frontmatter — since PageIndex
    //  doesn't carry aliases, we skip for now and match on route only)
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

      // 2. Check route aliases from site config
      const aliasTarget = options.site.routes[pathname] ??
        options.site.routes[normalized];
      if (aliasTarget) {
        const aliasPage = routeMap.get(normalizeRoute(aliasTarget));
        if (aliasPage) {
          return { type: "page", page: aliasPage };
        }
      }

      // 3. Direct route match
      const directMatch = routeMap.get(normalized);
      if (directMatch) {
        return { type: "page", page: directMatch };
      }

      // 4. Try with/without trailing slash
      if (normalized.endsWith("/")) {
        const withoutSlash = normalized.slice(0, -1);
        const match = routeMap.get(withoutSlash);
        if (match) return { type: "page", page: match };
      } else {
        const withSlash = normalized + "/";
        const match = routeMap.get(withSlash);
        if (match) return { type: "page", page: match };
      }

      // 5. Check for /index → / style routes
      if (normalized === "/" || normalized === "") {
        // Try matching a page with route "/"
        const homeMatch = routeMap.get("/");
        if (homeMatch) return { type: "page", page: homeMatch };
      }

      // Not found
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
     */
    getNavigation(): PageIndex[] {
      return options.pages
        .filter((p) => p.visible && p.published && p.routable && !p.isModule)
        .sort((a, b) => {
          // Sort by depth first, then order, then route
          if (a.depth !== b.depth) return a.depth - b.depth;
          if (a.order !== b.order) return a.order - b.order;
          return a.route.localeCompare(b.route);
        });
    },

    /**
     * Get top-level navigation items (depth 1).
     */
    getTopNavigation(): PageIndex[] {
      return this.getNavigation().filter((p) => p.depth === 1);
    },

    /**
     * Rebuild lookup maps (call after content index changes).
     */
    rebuild(pages: PageIndex[]) {
      options.pages = pages;
      routeMap.clear();
      aliasMap.clear();
      for (const page of pages) {
        if (!page.routable || !page.published) continue;
        if (page.status && page.status !== "published") continue;
        routeMap.set(normalizeRoute(page.route), page);
      }
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
