/**
 * REST API handlers — implements all 11 PRD-specified endpoints.
 *
 * Endpoints:
 *   GET /api/pages              — List all pages (with query params)
 *   GET /api/pages/:path        — Get single page (full content)
 *   GET /api/pages/:path/children — Get child pages
 *   GET /api/pages/:path/media  — Get page media files
 *   GET /api/collections        — Query collections
 *   GET /api/taxonomy           — List all taxonomies
 *   GET /api/taxonomy/:name     — Get values for a taxonomy
 *   GET /api/taxonomy/:name/:value — Get pages for a taxonomy value
 *   GET /api/search?q=term      — Full-text search
 *   GET /api/config/site        — Public site config
 *   GET /api/nav                — Navigation tree
 */

import type { DuneEngine } from "../core/engine.ts";
import type { CollectionEngine } from "../collections/engine.ts";
import type { TaxonomyEngine } from "../taxonomy/engine.ts";
import type { SearchEngine } from "../search/engine.ts";

export interface ApiHandlerOptions {
  engine: DuneEngine;
  collections: CollectionEngine;
  taxonomy: TaxonomyEngine;
  search: SearchEngine;
}

/**
 * Create the full API request handler.
 */
export function createApiHandler(options: ApiHandlerOptions) {
  const { engine, collections, taxonomy, search } = options;

  return async function handleApiRequest(req: Request): Promise<Response | null> {
    const url = new URL(req.url);
    const path = url.pathname;

    // Only handle /api/* routes
    if (!path.startsWith("/api/")) return null;

    // CORS: allow only explicitly configured origins. Using a wildcard would
    // allow any page to read raw page content, which is undesirable for private
    // sites. The origin derived from site.url is always permitted; additional
    // origins can be added via site.cors_origins for headless/decoupled setups.
    const siteUrl = engine.site.url;
    let primaryOrigin: string;
    try {
      primaryOrigin = new URL(siteUrl).origin;
    } catch {
      // site.url is not set or invalid — fall back to the request's own origin
      primaryOrigin = new URL(req.url).origin;
    }
    const extraOrigins = (engine.site.cors_origins ?? [])
      .map((o) => { try { return new URL(o).origin; } catch { return null; } })
      .filter(Boolean) as string[];
    const allowedOrigins = new Set([primaryOrigin, ...extraOrigins]);

    const requestOrigin = req.headers.get("origin");
    // Reflect the request origin back if it's in the allowed set; otherwise
    // respond with the primary origin (the browser will block the request).
    const corsOrigin = (requestOrigin && allowedOrigins.has(requestOrigin))
      ? requestOrigin
      : primaryOrigin;

    const corsHeaders = {
      "Access-Control-Allow-Origin": corsOrigin,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
    };

    // Handle OPTIONS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    try {
      const result = await routeApiRequest(path, url, engine, collections, taxonomy, search);
      if (!result) {
        return jsonResponse({ error: "Not found" }, 404, corsHeaders);
      }
      return jsonResponse(result, 200, corsHeaders);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return jsonResponse({ error: message }, 500, corsHeaders);
    }
  };
}

async function routeApiRequest(
  path: string,
  url: URL,
  engine: DuneEngine,
  collections: CollectionEngine,
  taxonomy: TaxonomyEngine,
  search: SearchEngine,
): Promise<unknown> {
  // GET /api/nav — navigation tree
  if (path === "/api/nav") {
    const nav = engine.router.getNavigation();
    return {
      items: nav.map((p) => ({
        route: p.route,
        title: p.title,
        order: p.order,
        depth: p.depth,
        template: p.template,
      })),
    };
  }

  // GET /api/config/site — public site config
  if (path === "/api/config/site") {
    const { title, description, url: siteUrl, author, metadata, taxonomies } = engine.site;
    return { title, description, url: siteUrl, author, metadata, taxonomies };
  }

  // GET /api/search?q=term
  if (path === "/api/search") {
    const q = url.searchParams.get("q");
    if (!q) return { items: [], total: 0, query: "" };
    const limit = parseInt(url.searchParams.get("limit") ?? "20");
    const results = search.search(q, limit);
    return {
      items: results.map((r) => ({
        route: r.page.route,
        title: r.page.title,
        score: r.score,
        excerpt: r.excerpt,
        template: r.page.template,
        format: r.page.format,
      })),
      total: results.length,
      query: q,
    };
  }

  // GET /api/collections — query collections via query params
  if (path === "/api/collections") {
    return handleCollectionQuery(url, collections);
  }

  // GET /api/taxonomy — list all taxonomies
  if (path === "/api/taxonomy") {
    const names = taxonomy.names();
    const result: Record<string, Record<string, number>> = {};
    for (const name of names) {
      result[name] = taxonomy.values(name);
    }
    return result;
  }

  // GET /api/taxonomy/:name/:value — pages for a specific taxonomy value
  const taxValueMatch = path.match(/^\/api\/taxonomy\/([^/]+)\/(.+)$/);
  if (taxValueMatch) {
    const [, taxName, taxValue] = taxValueMatch;
    const pages = taxonomy.find(taxName, taxValue);
    return {
      taxonomy: taxName,
      value: taxValue,
      items: pages.map((p) => ({
        route: p.route,
        title: p.title,
        date: p.date,
        template: p.template,
        format: p.format,
      })),
      total: pages.length,
    };
  }

  // GET /api/taxonomy/:name — values for a taxonomy
  const taxMatch = path.match(/^\/api\/taxonomy\/([^/]+)$/);
  if (taxMatch) {
    const name = taxMatch[1];
    const values = taxonomy.values(name);
    if (Object.keys(values).length === 0) {
      return null; // 404
    }
    return { name, values };
  }

  // GET /api/pages/:path/children
  if (path.match(/^\/api\/pages\/.+\/children$/)) {
    const pageRoute = path.replace("/api/pages", "").replace(/\/children$/, "");
    return handlePageChildren(pageRoute, engine);
  }

  // GET /api/pages/:path/media
  if (path.match(/^\/api\/pages\/.+\/media$/)) {
    const pageRoute = path.replace("/api/pages", "").replace(/\/media$/, "");
    return handlePageMedia(pageRoute, engine);
  }

  // GET /api/pages — list all pages
  if (path === "/api/pages") {
    return handlePageList(url, engine);
  }

  // GET /api/pages/:path — get single page
  if (path.startsWith("/api/pages/")) {
    const pageRoute = path.replace("/api/pages", "");
    return handleSinglePage(pageRoute, engine);
  }

  return null;
}

async function handlePageList(url: URL, engine: DuneEngine) {
  const limit = parseInt(url.searchParams.get("limit") ?? "20");
  const offset = parseInt(url.searchParams.get("offset") ?? "0");
  const template = url.searchParams.get("template");
  const published = url.searchParams.get("published");
  const orderBy = url.searchParams.get("order");

  let items = engine.pages.filter((p) => p.routable);

  // Published filter
  if (published !== null) {
    const pub = published === "true";
    items = items.filter((p) => p.published === pub);
  } else {
    items = items.filter((p) => p.published);
  }

  // Template filter
  if (template) {
    items = items.filter((p) => p.template === template);
  }

  // Taxonomy filters (e.g., taxonomy.tag=deno)
  for (const [key, value] of url.searchParams.entries()) {
    if (key.startsWith("taxonomy.")) {
      const taxName = key.replace("taxonomy.", "");
      items = items.filter((p) => {
        const vals = p.taxonomy[taxName];
        return vals && vals.includes(value);
      });
    }
  }

  // Ordering
  if (orderBy) {
    const [field, dir] = orderBy.split(":");
    const mult = dir === "asc" ? 1 : -1;
    items.sort((a, b) => {
      switch (field) {
        case "date":
          return ((a.date ?? "").localeCompare(b.date ?? "")) * mult;
        case "title":
          return a.title.localeCompare(b.title) * mult;
        case "order":
          return (a.order - b.order) * mult;
        default:
          return 0;
      }
    });
  }

  const total = items.length;
  items = items.slice(offset, offset + limit);

  return {
    items: items.map((p) => ({
      route: p.route,
      title: p.title,
      date: p.date,
      template: p.template,
      format: p.format,
      published: p.published,
      taxonomy: p.taxonomy,
    })),
    meta: {
      total,
      page: Math.floor(offset / limit) + 1,
      pages: Math.ceil(total / limit),
      limit,
    },
  };
}

async function handleSinglePage(pageRoute: string, engine: DuneEngine) {
  const result = await engine.resolve(pageRoute);
  if (result.type !== "page" || !result.page) return null;

  const page = result.page;
  const html = await page.html();

  return {
    route: page.route,
    title: page.frontmatter.title,
    date: page.frontmatter.date,
    template: page.template,
    format: page.format,
    rawContent: page.rawContent,
    html,
    frontmatter: page.frontmatter,
    media: page.media.map((m) => ({
      name: m.name,
      url: m.url,
      type: m.type,
      size: m.size,
    })),
  };
}

async function handlePageChildren(pageRoute: string, engine: DuneEngine) {
  const result = await engine.resolve(pageRoute);
  if (result.type !== "page" || !result.page) return null;

  const children = await result.page.children();
  return {
    items: children.map((c) => ({
      route: c.route,
      title: c.frontmatter.title,
      date: c.frontmatter.date,
      template: c.template,
      format: c.format,
      order: c.order,
    })),
    total: children.length,
  };
}

async function handlePageMedia(pageRoute: string, engine: DuneEngine) {
  const result = await engine.resolve(pageRoute);
  if (result.type !== "page" || !result.page) return null;

  return {
    items: result.page.media.map((m) => ({
      name: m.name,
      url: m.url,
      type: m.type,
      size: m.size,
      meta: m.meta,
    })),
    total: result.page.media.length,
  };
}

async function handleCollectionQuery(
  url: URL,
  collections: CollectionEngine,
) {
  // Build collection definition from query params
  const source = url.searchParams.get("source") ?? "@self.children";
  const orderBy = url.searchParams.get("order") ?? "date";
  const orderDir = (url.searchParams.get("dir") ?? "desc") as "asc" | "desc";
  const limit = parseInt(url.searchParams.get("limit") ?? "20");
  const offset = parseInt(url.searchParams.get("offset") ?? "0");
  const template = url.searchParams.get("template");

  // Parse source
  let items: any;
  if (source.startsWith("@page.children:")) {
    items = { "@page.children": source.replace("@page.children:", "") };
  } else if (source.startsWith("@page.descendants:")) {
    items = { "@page.descendants": source.replace("@page.descendants:", "") };
  } else if (source.startsWith("@taxonomy.")) {
    const [, taxSpec] = source.split("@taxonomy.");
    const [taxName, ...taxValues] = taxSpec.split(":");
    items = { [`@taxonomy.${taxName}`]: taxValues.join(":") };
  } else {
    items = { "@self.children": true };
  }

  const definition = {
    items,
    order: { by: orderBy, dir: orderDir },
    filter: {
      published: true,
      ...(template ? { template } : {}),
    },
    limit,
    offset,
  };

  const collection = await collections.query(definition);

  return {
    items: collection.items.map((p) => ({
      route: p.route,
      title: p.frontmatter.title,
      date: p.frontmatter.date,
      template: p.template,
      format: p.format,
    })),
    meta: {
      total: collection.total,
      page: collection.page,
      pages: collection.pages,
      hasNext: collection.hasNext,
      hasPrev: collection.hasPrev,
    },
  };
}

function jsonResponse(
  data: unknown,
  status: number = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}
