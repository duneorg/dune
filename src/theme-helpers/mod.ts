/**
 * Dune Theme Helpers — stable API for theme templates.
 *
 * Import from this module instead of CMS internals so your theme stays
 * decoupled from the engine's file structure.
 *
 * @example
 * ```ts
 * import { formatDate, paginate, truncate } from "../../../src/theme-helpers/mod.ts";
 * ```
 *
 * Future: published as `jsr:@dune/theme-helpers` when the API is stable.
 */

// ─── Re-exported types ────────────────────────────────────────────────────────
// These are the types your templates will interact with.  Import them from
// here rather than the internal `../../src/content/types.ts` paths.

export type {
  ContentFormat,
  PageFrontmatter,
  MediaFile,
  Page,
  PageIndex,
  Collection,
  CollectionDefinition,
  TemplateComponent,
  TemplateProps,
  ContentPageProps,
} from "../content/types.ts";

export type { DuneConfig, SiteConfig, ThemeConfig } from "../config/types.ts";

// Re-export the existing title builder so themes don't need a separate import.
export { buildPageTitle } from "../content/types.ts";

// ─── Pagination ───────────────────────────────────────────────────────────────

/** Result of paginating an array. */
export interface PaginationResult<T> {
  /** Items on the current page. */
  items: T[];
  /** Current page number (1-based). */
  page: number;
  /** Items per page. */
  perPage: number;
  /** Total number of items across all pages. */
  total: number;
  /** Total number of pages. */
  totalPages: number;
  /** Whether there is a next page. */
  hasNext: boolean;
  /** Whether there is a previous page. */
  hasPrev: boolean;
}

/**
 * Paginate an array.
 *
 * @param items   Full array to paginate.
 * @param page    Current page number (1-based). Clamped to [1, totalPages].
 * @param perPage Items per page (minimum 1).
 *
 * @example
 * ```ts
 * const result = paginate(allPosts, currentPage, 10);
 * // result.items → posts for this page
 * // result.totalPages → total number of pages
 * ```
 */
export function paginate<T>(
  items: T[],
  page: number,
  perPage: number,
): PaginationResult<T> {
  const safePerPage = Math.max(1, Math.floor(perPage));
  const totalPages = Math.max(1, Math.ceil(items.length / safePerPage));
  const safePage = Math.min(Math.max(1, Math.floor(page)), totalPages);
  const start = (safePage - 1) * safePerPage;
  return {
    items: items.slice(start, start + safePerPage),
    page: safePage,
    perPage: safePerPage,
    total: items.length,
    totalPages,
    hasNext: safePage < totalPages,
    hasPrev: safePage > 1,
  };
}

// ─── Date formatting ──────────────────────────────────────────────────────────

/**
 * Format a Unix millisecond timestamp as a localised date string.
 *
 * @param timestamp Milliseconds since epoch (e.g. `page.frontmatter.date`).
 * @param locale    BCP-47 locale tag.  Defaults to `"en"`.
 * @param options   `Intl.DateTimeFormatOptions`.  Defaults to
 *                  `{ day: "numeric", month: "short", year: "numeric" }`.
 *
 * @example
 * ```ts
 * formatDate(page.frontmatter.date!)           // → "12 Mar 2026"
 * formatDate(page.frontmatter.date!, "de")     // → "12. März 2026"
 * formatDate(ts, "en", { month: "long" })      // → "March 12, 2026"
 * ```
 */
export function formatDate(
  timestamp: number,
  locale = "en",
  options: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "short",
    year: "numeric",
  },
): string {
  return new Intl.DateTimeFormat(locale, options).format(new Date(timestamp));
}

// ─── URL helpers ──────────────────────────────────────────────────────────────

/**
 * Build a canonical URL by combining a site's base URL with a request pathname.
 *
 * Trailing slashes are normalised: the result never ends with `/` unless the
 * combined URL is exactly the site root.
 *
 * @example
 * ```ts
 * getCanonicalUrl("https://example.com", "/blog/hello/") // → "https://example.com/blog/hello"
 * getCanonicalUrl("https://example.com/", "/")           // → "https://example.com/"
 * ```
 */
export function getCanonicalUrl(siteUrl: string, pathname: string): string {
  const base = siteUrl.replace(/\/$/, "");
  const path = pathname === "/" ? "/" : pathname.replace(/\/$/, "");
  return `${base}${path}`;
}

/**
 * Build a URL to the built-in /search page with the query pre-filled.
 *
 * @param query Search query string.
 * @param base  Base path for the search page (defaults to `"/search"`).
 *
 * @example
 * ```ts
 * getSearchUrl("deno")               // → "/search?q=deno"
 * getSearchUrl("hello world")        // → "/search?q=hello%20world"
 * getSearchUrl("deno", "/en/search") // → "/en/search?q=deno"
 * ```
 */
export function getSearchUrl(query: string, base?: string): string {
  return `${base ?? "/search"}?q=${encodeURIComponent(query)}`;
}

// ─── Sorting ──────────────────────────────────────────────────────────────────

import type { PageIndex } from "../content/types.ts";

/**
 * Sort a `PageIndex[]` by a given field.
 *
 * @param pages Pages to sort (original array is not mutated).
 * @param field `"title"` | `"date"` | `"order"`.
 * @param dir   `"asc"` | `"desc"`.
 */
export function sortPages(
  pages: PageIndex[],
  field: "title" | "date" | "order",
  dir: "asc" | "desc" = "asc",
): PageIndex[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...pages].sort((a, b) => {
    if (field === "title") {
      return sign * a.title.localeCompare(b.title);
    }
    if (field === "date") {
      const ad = a.date ? new Date(a.date).getTime() : 0;
      const bd = b.date ? new Date(b.date).getTime() : 0;
      return sign * (ad - bd);
    }
    // "order"
    return sign * (a.order - b.order);
  });
}

// ─── Grouping ─────────────────────────────────────────────────────────────────

/**
 * Group pages by the year of their `date` field.
 *
 * Pages without a `date` are placed under the key `0`.
 *
 * Note: object keys are sorted numerically by the JavaScript engine regardless
 * of insertion order.  To iterate years in a specific order, sort the keys
 * yourself:
 * ```ts
 * const byYear = groupByYear(posts);
 * const years = Object.keys(byYear).map(Number).sort((a, b) => b - a); // desc
 * ```
 *
 * @example
 * ```ts
 * const byYear = groupByYear(posts);
 * // { 2025: [PageIndex, ...], 2026: [PageIndex, ...] }
 * ```
 */
export function groupByYear(pages: PageIndex[]): Record<number, PageIndex[]> {
  const groups: Record<number, PageIndex[]> = {};
  for (const page of pages) {
    const year = page.date ? new Date(page.date).getFullYear() : 0;
    (groups[year] ??= []).push(page);
  }
  return groups;
}

// ─── Text helpers ─────────────────────────────────────────────────────────────

/**
 * Truncate a string to at most `length` characters, breaking at the last word
 * boundary within that limit.
 *
 * @param text   Input string.
 * @param length Maximum character count (including suffix).
 * @param suffix String appended when truncation occurs.  Defaults to `"…"`.
 *
 * @example
 * ```ts
 * truncate("Hello world, how are you?", 15) // → "Hello world,…"
 * truncate("Short", 100)                    // → "Short"
 * ```
 */
export function truncate(text: string, length: number, suffix = "…"): string {
  if (text.length <= length) return text;
  const available = length - suffix.length;
  if (available <= 0) return suffix;
  const cut = text.slice(0, available);
  // Break at last whitespace to avoid chopping mid-word
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut) + suffix;
}
