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
import type { FlexEngine } from "../flex/engine.ts";
import type { PageIndex } from "../content/types.ts";
import { effectiveOrder } from "../content/path-utils.ts";
import { RateLimiter, clientIp } from "../security/rate-limit.ts";

// Per-IP rate limit for public API. Generous enough for legitimate headless
// consumers (~2 req/sec) but cheap to enforce. Protects against trivial CPU
// DoS on /api/search, /api/collections, and /api/taxonomy/*.
const apiRateLimiter = new RateLimiter(120, 60 * 1000);

// One-shot warning latch when `site.url` is missing — emit once per process.
let warnedMissingSiteUrl = false;

// Flex Object type/id segments are interpolated into filesystem paths
// (`flex-objects/<type>/<id>.yaml`). Restrict to a conservative charset so
// `..` / `/` / null bytes / encoded variants can never escape the flex root.
const SAFE_FLEX_SEGMENT_RE = /^[A-Za-z0-9_-]{1,64}$/;
function isSafeFlexSegment(s: string): boolean {
  return SAFE_FLEX_SEGMENT_RE.test(s);
}

/**
 * Parse a non-negative integer query parameter and clamp it to a sane range.
 * - parseInt(null|undefined) -> def
 * - NaN / non-finite -> def
 * - clamps into [min, max]
 *
 * Used for limit/offset on the public API so attackers can't request huge
 * pages or feed `slice(0, 999999999)` calls.
 */
function clampInt(raw: string | null, def: number, min: number, max: number): number {
  if (raw === null || raw === undefined) return def;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return def;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

export interface ApiHandlerOptions {
  engine: DuneEngine;
  collections: CollectionEngine;
  taxonomy: TaxonomyEngine;
  search: SearchEngine;
  /** Optional Flex Object engine for public GET /api/flex/:type endpoints. */
  flex?: FlexEngine;
}

/**
 * Create the full API request handler.
 */
export function createApiHandler(options: ApiHandlerOptions) {
  const { engine, collections, taxonomy, search, flex } = options;

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
    let primaryOrigin: string | null = null;
    try {
      primaryOrigin = new URL(siteUrl).origin;
    } catch {
      // site.url is missing or unparseable. Previously this fell back to
      // reflecting the request origin, which effectively turned CORS off.
      // Now we fail closed: emit no Access-Control-Allow-Origin header
      // unless the request origin is in cors_origins.
      if (!warnedMissingSiteUrl) {
        console.warn(
          "[dune] site.url is missing or invalid — API CORS will refuse cross-origin requests " +
            "until `site: { url: https://your-site }` is set in site.yaml " +
            "or specific origins are listed in `site.cors_origins`.",
        );
        warnedMissingSiteUrl = true;
      }
    }
    const extraOrigins = (engine.site.cors_origins ?? [])
      .map((o) => { try { return new URL(o).origin; } catch { return null; } })
      .filter(Boolean) as string[];
    const allowedOrigins = new Set<string>([
      ...(primaryOrigin ? [primaryOrigin] : []),
      ...extraOrigins,
    ]);

    const requestOrigin = req.headers.get("origin");
    const isAllowed = requestOrigin !== null && allowedOrigins.has(requestOrigin);

    // Build CORS headers. When the origin isn't allowed we emit no
    // Access-Control-Allow-Origin header at all — the browser will block
    // the cross-origin response. Same-origin and non-browser callers
    // continue to work because they don't require ACAO.
    const corsHeaders: Record<string, string> = {
      "Vary": "Origin",
    };
    if (isAllowed) {
      corsHeaders["Access-Control-Allow-Origin"] = requestOrigin!;
      corsHeaders["Access-Control-Allow-Methods"] = "GET, OPTIONS";
      corsHeaders["Access-Control-Allow-Headers"] = "Content-Type";
    }

    // Handle OPTIONS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // Rate limit expensive read endpoints. Cheap list/get for /api/nav and
    // /api/config/site are exempt — they serve from an in-memory index.
    if (
      path.startsWith("/api/search") ||
      path.startsWith("/api/collections") ||
      path.startsWith("/api/taxonomy") ||
      path.startsWith("/api/pages") ||
      path.startsWith("/api/flex/")
    ) {
      const ip = clientIp(req);
      if (!apiRateLimiter.check(ip)) {
        return jsonResponse(
          { error: "Too many requests" },
          429,
          { ...corsHeaders, "Retry-After": String(apiRateLimiter.retryAfter(ip)) },
        );
      }
    }

    try {
      const result = await routeApiRequest(path, url, engine, collections, taxonomy, search, flex);
      if (!result) {
        return jsonResponse({ error: "Not found" }, 404, corsHeaders);
      }
      return jsonResponse(result, 200, corsHeaders);
    } catch (err) {
      // Never reflect internal error strings on the public, unauthenticated
      // API. Server-side log retains full context for operators.
      console.error("[dune public-api]", path, err);
      return jsonResponse({ error: "Internal server error" }, 500, corsHeaders);
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
  flex?: FlexEngine,
): Promise<unknown> {
  // GET /api/nav — navigation tree
  if (path === "/api/nav") {
    const nav = engine.router.getNavigation();
    return {
      items: nav.map((p: PageIndex) => ({
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
    // Cap query length: long queries explode tokenization/fuzzy-match cost
    // and create an unauthenticated CPU-DoS vector. 256 chars is far above
    // any natural search query.
    if (q.length > 256) {
      return { items: [], total: 0, query: q.slice(0, 256), error: "Query too long" };
    }
    // Cap and floor the limit. parseInt accepts garbage as NaN, and very
    // large limits force the search engine to allocate huge result arrays.
    const rawLimit = parseInt(url.searchParams.get("limit") ?? "20", 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 20;
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

  // === Flex Object public API ===
  // Read-only access to Flex Object records (same CORS rules as other /api/* routes).

  if (flex && path.startsWith("/api/flex/")) {
    const parts = path.split("/"); // ["", "api", "flex", type?, id?]

    // GET /api/flex/:type — list all records for a type
    if (parts.length === 4) {
      const type = decodeURIComponent(parts[3]);
      if (!isSafeFlexSegment(type)) return null;
      const schemas = await flex.loadSchemas();
      if (!schemas[type]) return null;
      const records = await flex.list(type);
      return { items: records, total: records.length };
    }

    // GET /api/flex/:type/:id — get single record
    if (parts.length === 5) {
      const type = decodeURIComponent(parts[3]);
      const id = decodeURIComponent(parts[4]);
      if (!isSafeFlexSegment(type) || !isSafeFlexSegment(id)) return null;
      const schemas = await flex.loadSchemas();
      if (!schemas[type]) return null;
      const record = await flex.get(type, id);
      return record ?? null;
    }
  }

  return null;
}

async function handlePageList(url: URL, engine: DuneEngine) {
  const limit = clampInt(url.searchParams.get("limit"), 20, 1, 200);
  const offset = clampInt(url.searchParams.get("offset"), 0, 0, 1_000_000);
  const template = url.searchParams.get("template");
  const published = url.searchParams.get("published");
  const orderBy = url.searchParams.get("order");

  let items = engine.pages.filter((p) => p.routable);

  // Published filter — public API only ever returns published pages,
  // regardless of the `published` query parameter. Previously
  // ?published=false returned metadata for every draft, which exposed
  // forthcoming titles, slugs, dates, and taxonomies to anonymous
  // readers. Authenticated draft enumeration belongs on the admin API
  // (under requirePermission("pages.read")), not here.
  void published;
  items = items.filter((p) => p.published);

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
          return (effectiveOrder(a.order) - effectiveOrder(b.order)) * mult;
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
  const limit = clampInt(url.searchParams.get("limit"), 20, 1, 200);
  const offset = clampInt(url.searchParams.get("offset"), 0, 0, 1_000_000);
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
