/**
 * Content query API for headless mode.
 *
 * Provides an ergonomic, idiomatic interface for Fresh route handlers to fetch
 * content from Dune without directly accessing the engine internals.
 *
 * Initialized once via `initContent()` (called automatically by `bootstrap()`).
 * Use `getContent()` anywhere after bootstrap to obtain the API object.
 *
 * @example
 * ```ts
 * // routes/blog/[slug].tsx
 * import { getContent, type ResolvedPage } from "@dune/cms/content";
 *
 * export async function handler(ctx: FreshContext) {
 *   const post = await getContent().page(`/blog/${ctx.params.slug}`);
 *   if (!post) return ctx.next();
 *   return ctx.render(post);
 * }
 * ```
 *
 * ### Typed frontmatter
 *
 * Pass your frontmatter interface as a type parameter to `page<FM>()`:
 *
 * ```ts
 * interface BlogPost {
 *   title: string;
 *   date: string;
 *   tags: string[];
 * }
 *
 * const post = await getContent().page<BlogPost>(`/blog/${slug}`);
 * // post?.frontmatter.tags → string[]  ✅
 * ```
 *
 * Blueprint schemas (Zod-based typed validation per blueprint) are tracked as
 * a follow-on feature; see plan-headless-mode.md §4 for the spec.
 *
 * @module
 * @since 1.1.0
 */

import type { DuneEngine } from "../core/engine.ts";
import type { SearchEngine } from "../search/engine.ts";
import type { CollectionEngine } from "../collections/engine.ts";
import type { TaxonomyEngine } from "../taxonomy/engine.ts";
import type { PageIndex } from "./types.ts";

// ── Public types ─────────────────────────────────────────────────────────────

/**
 * A fully resolved page — HTML rendered, frontmatter loaded, ready for use in
 * a Fresh route handler or API endpoint.
 *
 * @typeParam FM - Frontmatter shape. Defaults to `Record<string, unknown>`.
 *   Pass your own interface for type-safe field access:
 *   `getContent().page<BlogPost>("/blog/hello")`
 */
export interface ResolvedPage<FM = Record<string, unknown>> {
  /** URL route — e.g. "/blog/hello-world" */
  route: string;
  /** Page title from frontmatter */
  title: string;
  /** ISO date string, or null if not set */
  date: string | null;
  /** Rendered HTML (from Markdown/MDX/TSX component) */
  html: string;
  /** Parsed frontmatter — typed as FM (defaults to Record<string, unknown>) */
  frontmatter: FM;
  /** BCP-47 language code (e.g. "en", "de") */
  language: string;
  /** Whether the page is published */
  published: boolean;
  /** Nav display title (falls back to `title`) */
  navTitle: string;
  /** Absolute URL built from site URL + route, or null if site URL is not set */
  url: string | null;
}

/** A single search result. */
export interface ContentSearchResult {
  route: string;
  title: string;
  score: number;
  excerpt?: string;
}

/**
 * A resolved taxonomy term with its associated page count.
 *
 * If any published page declares `termPageFor` pointing at this term,
 * `pageRoute` is set to that page's route. Otherwise null.
 *
 * Use `getContent().termPage(vocab, value)` to resolve the full page with
 * rendered HTML and typed frontmatter.
 */
export interface TaxonomyTerm {
  name: string;
  slug: string;
  count: number;
  /** Route of the term page (from `termPageFor` frontmatter), or null. */
  pageRoute: string | null;
}

/** Filtering and sorting options for `ContentApi.pages()`. */
export interface PagesOptions {
  /** Filter by collection name. */
  collection?: string;
  /** Filter pages that have a specific taxonomy tag value. */
  tag?: string;
  /** Filter by taxonomy name and value. e.g. { name: "category", value: "news" } */
  taxonomy?: { name: string; value: string };
  /** Maximum number of pages to return. */
  limit?: number;
  /** Number of pages to skip before returning results. */
  offset?: number;
  /** Only return published pages. Defaults to true. */
  published?: boolean;
  /** Filter by language code. */
  language?: string;
  /** Sort order. Defaults to "order". */
  orderBy?: "date" | "title" | "order";
  /** Sort direction. Defaults to "asc". */
  orderDir?: "asc" | "desc";
}

/**
 * The Dune content query API.
 * Obtain an instance via `getContent()`.
 */
export interface ContentApi {
  /**
   * Resolve a single page by URL route.
   *
   * Returns `null` if no page exists at the given route.
   * The HTML is rendered lazily (first access triggers Markdown/MDX/TSX processing).
   *
   * @param route - Absolute URL path, e.g. "/blog/hello-world"
   */
  page<FM = Record<string, unknown>>(route: string): Promise<ResolvedPage<FM> | null>;

  /**
   * Query the content index for pages matching the given criteria.
   *
   * Returns `PageIndex[]` (lightweight references — HTML is NOT pre-rendered).
   * Use `page()` to resolve individual pages when you need rendered HTML.
   */
  pages(opts?: PagesOptions): PageIndex[];

  /**
   * Full-text search across all indexed content.
   *
   * Returns synchronously (the search index is in-memory). Requires
   * `buildSearch: true` in the `bootstrap()` call, or `search.build()`
   * to have been called separately — otherwise the index is empty and
   * all queries return no results.
   *
   * @param query - Search query string
   * @param opts.limit - Maximum results to return (default: 10)
   */
  search(query: string, opts?: { limit?: number }): Promise<ContentSearchResult[]>;

  /**
   * List all terms for a taxonomy.
   *
   * Each term includes a `pageRoute` pointing to its associated term page
   * if one exists (i.e. a page that declares `termPageFor` for this term).
   *
   * @param name - Taxonomy name as configured in `dune.yaml` (e.g. "tag", "category")
   */
  taxonomy(name: string): TaxonomyTerm[];

  /**
   * Resolve the term page for a taxonomy term.
   *
   * A term page is any published content page that declares `termPageFor`
   * in its frontmatter pointing at the given vocabulary and value:
   *
   * ```yaml
   * # Simple form — implies the "tag" vocabulary:
   * termPageFor: ewr
   *
   * # Explicit vocabulary:
   * termPageFor:
   *   category: politics
   * ```
   *
   * Returns `null` if no such page exists.
   *
   * @param vocab - Taxonomy vocabulary name, e.g. "tag", "category"
   * @param value - Term value, e.g. "ewr"
   */
  termPage<FM = Record<string, unknown>>(
    vocab: string,
    value: string,
  ): Promise<ResolvedPage<FM> | null>;
}

// ── Singleton ─────────────────────────────────────────────────────────────────

interface ContentContext {
  engine: DuneEngine;
  search: SearchEngine;
  collections: CollectionEngine;
  taxonomy: TaxonomyEngine;
}

let _ctx: ContentContext | null = null;

/**
 * Initialize the content API singleton. Called automatically by `bootstrap()`.
 * External callers should not need to call this directly.
 * @internal
 */
export function initContent(ctx: ContentContext): void {
  _ctx = ctx;
}

/**
 * Return the content API for the current site.
 *
 * Throws if `bootstrap()` has not been called yet — the API requires an
 * initialized engine, search index, and taxonomy engine.
 *
 * @example
 * ```ts
 * const api = getContent();
 * const post = await api.page("/blog/hello-world");
 * const recent = api.pages({ limit: 5, orderBy: "date", orderDir: "desc" });
 * ```
 */
export function getContent(): ContentApi {
  if (!_ctx) {
    throw new Error(
      "[dune] Content API not initialized. Ensure bootstrap() has been called before using getContent().",
    );
  }
  return buildApi(_ctx);
}

// ── Implementation ────────────────────────────────────────────────────────────

function buildApi(ctx: ContentContext): ContentApi {
  const { engine, search, taxonomy } = ctx;

  // Build a two-level lookup map: vocab → value → route, from all published
  // pages that declare termPageFor. Built once per buildApi() call from the
  // in-memory page index — no file I/O.
  //
  // Using Map<vocab, Map<value, route>> rather than a flat map with a
  // "vocab:value" composite key avoids key collisions when vocab names
  // contain the separator character.
  const termPageMap = new Map<string, Map<string, string>>();
  for (const page of engine.pages) {
    if (!page.published || !page.termPageFor) continue;
    for (const [vocab, value] of Object.entries(page.termPageFor)) {
      let inner = termPageMap.get(vocab);
      if (!inner) { inner = new Map(); termPageMap.set(vocab, inner); }
      inner.set(value, page.route);
    }
  }

  return {
    async page<FM = Record<string, unknown>>(
      route: string,
    ): Promise<ResolvedPage<FM> | null> {
      const result = await engine.resolve(route);
      if (result.type !== "page" || !result.page) return null;

      const page = result.page;
      const index = engine.pages.find((p) => p.route === route);
      if (!index) return null;

      const html = await page.html();

      // Determine site URL for building absolute URLs
      const siteUrl = engine.site.url?.replace(/\/$/, "") ?? null;

      return {
        route,
        title: page.frontmatter.title || index.title,
        date: index.date,
        html,
        frontmatter: page.frontmatter as FM,
        language: index.language,
        published: index.published,
        navTitle: index.navTitle,
        url: siteUrl ? `${siteUrl}${route}` : null,
      };
    },

    pages(opts: PagesOptions = {}): PageIndex[] {
      const {
        tag,
        taxonomy: tax,
        limit,
        offset = 0,
        published = true,
        language,
        orderBy = "order",
        orderDir = "asc",
      } = opts;

      let pages = [...engine.pages];

      // Filter: published
      if (published !== undefined) {
        pages = pages.filter((p) => p.published === published);
      }

      // Filter: language
      if (language) {
        pages = pages.filter((p) => p.language === language);
      }

      // Filter: tag (shorthand for taxonomy "tag")
      if (tag) {
        const taxMap = engine.taxonomyMap["tag"] ?? {};
        const tagSlug = tag.toLowerCase().replace(/\s+/g, "-");
        const matchingRoutes = new Set(taxMap[tag] ?? taxMap[tagSlug] ?? []);
        pages = pages.filter((p) => matchingRoutes.has(p.sourcePath));
      }

      // Filter: taxonomy (name + value)
      if (tax) {
        const taxMap = engine.taxonomyMap[tax.name] ?? {};
        const matchingPaths = new Set(taxMap[tax.value] ?? []);
        pages = pages.filter((p) => matchingPaths.has(p.sourcePath));
      }

      // Sort
      pages.sort((a, b) => {
        let cmp = 0;
        if (orderBy === "date") {
          cmp = (a.date ?? "").localeCompare(b.date ?? "");
        } else if (orderBy === "title") {
          cmp = a.title.localeCompare(b.title);
        } else {
          // "order" — numeric prefix ordering
          cmp = (a.order ?? 0) - (b.order ?? 0);
        }
        return orderDir === "desc" ? -cmp : cmp;
      });

      // Pagination
      const sliced = limit !== undefined
        ? pages.slice(offset, offset + limit)
        : pages.slice(offset);

      return sliced;
    },

    async search(
      query: string,
      opts: { limit?: number } = {},
    ): Promise<ContentSearchResult[]> {
      const { limit = 10 } = opts;
      const results = await search.search(query, limit);
      return results.map((r) => ({
        route: r.page.route,
        title: r.page.title,
        score: r.score,
        excerpt: r.excerpt,
      }));
    },

    taxonomy(name: string): TaxonomyTerm[] {
      const valueMap = taxonomy.values(name);
      return Object.entries(valueMap).map(([value, count]) => ({
        name: value,
        slug: value.toLowerCase().replace(/\s+/g, "-"),
        count,
        pageRoute: termPageMap.get(name)?.get(value) ?? null,
      })).sort((a, b) => b.count - a.count);
    },

    async termPage<FM = Record<string, unknown>>(
      vocab: string,
      value: string,
    ): Promise<ResolvedPage<FM> | null> {
      const route = termPageMap.get(vocab)?.get(value);
      if (!route) return null;

      const result = await engine.resolve(route);
      if (result.type !== "page" || !result.page) return null;

      const page = result.page;
      const index = engine.pages.find((p) => p.route === route);
      if (!index) return null;

      const html = await page.html();
      const siteUrl = engine.site.url?.replace(/\/$/, "") ?? null;

      return {
        route,
        title: page.frontmatter.title || index.title,
        date: index.date,
        html,
        frontmatter: page.frontmatter as FM,
        language: index.language,
        published: index.published,
        navTitle: index.navTitle,
        url: siteUrl ? `${siteUrl}${route}` : null,
      };
    },
  };
}
