/**
 * Content type definitions for Dune CMS.
 * Covers content formats, pages, media, collections, and the format handler interface.
 */

import type { DuneConfig, SiteConfig } from "../config/types.ts";

// === Content Format ===

/** Content format discriminator */
export type ContentFormat = "md" | "tsx" | "mdx";

// === Frontmatter ===

/** Raw frontmatter parsed from YAML (.md/.mdx) or extracted from export (.tsx) */
export interface PageFrontmatter {
  title: string;
  /** Short descriptor/subtitle shown after the title in the browser tab.
   *  Produces: "Title - Descriptor | Site Name" */
  descriptor?: string;
  /** Navigation label override — shown in nav instead of title.
   *  Use when the SEO title is too long for the navigation menu. */
  nav_title?: string;
  /** Page heading override — shown as the h1 instead of title.
   *  Use when the SEO title differs from the desired on-page heading. */
  heading?: string;
  slug?: string;
  /** Explicit sort order. Overrides the numeric folder/filename prefix when set. */
  order?: number;
  template?: string;
  /** Layout control (TSX content files): string = named layout, false = no layout */
  layout?: string | false;
  published?: boolean;
  /** Content workflow status */
  status?: "draft" | "in_review" | "published" | "archived";
  date?: string;
  publish_date?: string;
  unpublish_date?: string;
  visible?: boolean;
  routable?: boolean;
  taxonomy?: Record<string, string[]>;
  metadata?: Record<string, string>;
  routes?: {
    aliases?: string[];
    canonical?: string;
  };
  summary?: {
    size?: number;
    format?: "short" | "long";
  };
  cache?: {
    enable?: boolean;
    lifetime?: number;
  };
  collection?: CollectionDefinition;
  /**
   * Declares this page as the term page for a taxonomy term.
   *
   * Simple form (implies the `tag` vocabulary):
   * ```yaml
   * termPageFor: ewr
   * ```
   *
   * Explicit vocabulary form:
   * ```yaml
   * termPageFor:
   *   category: politics
   * ```
   *
   * The content API exposes this via `TaxonomyTerm.pageRoute` and
   * `getContent().termPage(vocab, value)`.
   */
  termPageFor?: string | Record<string, string>;
  custom?: Record<string, unknown>;
  /**
   * Visual Page Builder sections.
   * Present when `layout: "page-builder"` — the routing layer renders these
   * as the page body instead of the markdown content.
   */
  sections?: Array<{ id: string; type: string; [field: string]: unknown }>;
  /** Allow additional fields beyond the spec */
  [key: string]: unknown;
}

// === Media ===

/** A co-located media file */
export interface MediaFile {
  /** Filename: "cover.jpg" */
  name: string;
  /** Full path relative to content root */
  path: string;
  /** MIME type */
  type: string;
  /** File size in bytes */
  size: number;
  /** Sidecar metadata (from .meta.yaml) */
  meta: Record<string, unknown>;
  /** URL to serve this file */
  url: string;
}

/** Helper for resolving co-located media from within .tsx content pages */
export interface MediaHelper {
  /** Get URL for a co-located media file */
  url(filename: string): string;
  /** Get full MediaFile object */
  get(filename: string): MediaFile | null;
  /** List all media files for this page */
  list(): MediaFile[];
}

// === Page ===

/**
 * Context object passed to Fresh-style `handler` exports in .tsx content pages.
 *
 * @example
 * ```ts
 * // content/contact.tsx
 * import type { ContentHandlerContext } from "@dune/cms/content";
 *
 * export const handler = {
 *   POST: async (req: Request, ctx: ContentHandlerContext) => {
 *     // Reject cross-origin POSTs for session-guarded mutations.
 *     // Omit this check for webhooks and public API endpoints that should
 *     // accept cross-origin requests.
 *     const denied = ctx.csrfCheck();
 *     if (denied) return denied;
 *
 *     const form = await req.formData();
 *     // ... process form
 *     return ctx.render({ success: true });
 *   },
 * };
 * ```
 */
export interface ContentHandlerContext {
  /** The incoming request (same object passed to the handler). */
  req: Request;
  /** Parsed URL of the request. */
  url: URL;
  /** URL path parameters (always `{}` for content pages — no dynamic segments). */
  params: Record<string, string>;
  /**
   * Render the page component with the given data and return an HTTP response.
   * The data is passed to the component as `props.data`.
   */
  render: (data: unknown) => Promise<Response>;
  /**
   * Same-origin CSRF check for mutating requests (POST, PUT, DELETE, PATCH).
   *
   * Returns a `403 Forbidden` response if the request carries an `Origin`
   * header pointing at a different host, `null` otherwise.
   *
   * Safe methods (GET, HEAD, OPTIONS) and requests without an `Origin` header
   * (server-to-server calls, webhooks, curl) always return `null`.
   *
   * Call this at the top of any handler that performs a state-changing
   * operation guarded by a session cookie. Skip it for endpoints that
   * legitimately accept cross-origin POST (webhooks, CORS APIs).
   */
  csrfCheck: () => Response | null;
}

/** A fully resolved page object (loaded on demand) */
export interface Page {
  /** Unique path relative to content root: "02.blog/01.hello-world" */
  sourcePath: string;
  /** URL slug: "/blog/hello-world" */
  route: string;
  /** Language code (from PageIndex) */
  language: string;
  /** Content format: "md", "tsx", or "mdx" */
  format: ContentFormat;
  /** Resolved template name: "post" (for .md/.mdx) or "self" (for .tsx) */
  template: string;
  /** Navigation label — falls back to title when nav_title is not set */
  navTitle: string;
  /** Parsed frontmatter */
  frontmatter: PageFrontmatter;
  /** Raw markdown body — only for .md/.mdx (not rendered — lazy) */
  rawContent: string | null;
  /** Rendered HTML (lazy, cached) — for .md/.mdx pages */
  html: () => Promise<string>;
  /** JSX render function — for .tsx pages (dynamically imported) */
  component: () => Promise<TemplateComponent | null>;
  /**
   * Fresh-style request handlers exported from a .tsx content page.
   * When a .tsx page exports `handler: Handlers<T>`, Dune dispatches the
   * request through it before (or instead of) rendering the component.
   * Mirrors Fresh's `export const handler: Handlers<Data>` idiom exactly.
   */
  handlers: () => Promise<Record<string, (req: Request, ctx: ContentHandlerContext) => Response | Promise<Response>> | null>;
  /** Co-located media files */
  media: MediaFile[];
  /** Navigation order (from numeric prefix, or frontmatter) */
  order: number;
  /** Page depth in content tree */
  depth: number;
  /** Whether this is a modular section */
  isModule: boolean;
  /** Child module pages (for modular parent pages) */
  modules: () => Promise<Page[]>;
  /** Parent page (lazy reference) */
  parent: () => Promise<Page | null>;
  /** Child pages (lazy reference) */
  children: () => Promise<Page[]>;
  /** Sibling pages (lazy reference) */
  siblings: () => Promise<Page[]>;
  /** Summary/excerpt */
  summary: () => Promise<string>;
  /**
   * Plain-text excerpt, populated synchronously after the page has been
   * loaded through a Collection (i.e. after `collection.load()` resolves).
   * Equivalent to the resolved value of `summary()`. Undefined outside of
   * a collection context — use `await page.summary()` there instead.
   */
  excerpt?: string;
}

/** Lightweight page reference for the content index (never loads full content) */
export interface PageIndex {
  sourcePath: string;
  route: string;
  /** Language code (from filename suffix or config default) */
  language: string;
  /** Content format */
  format: ContentFormat;
  template: string;
  title: string;
  /** Navigation label — falls back to title when nav_title is not set */
  navTitle: string;
  date: string | null;
  published: boolean;
  /** Content workflow status */
  status: "draft" | "in_review" | "published" | "archived";
  visible: boolean;
  routable: boolean;
  isModule: boolean;
  order: number;
  depth: number;
  parentPath: string | null;
  taxonomy: Record<string, string[]>;
  /** File modification time — for incremental cache invalidation */
  mtime: number;
  /** Hash of frontmatter — for change detection */
  hash: string;
  /**
   * URL path to the cover/featured image for this page.
   * Derived from `frontmatter.image` at index time.
   * E.g. "/content-media/02.blog/01.post/cover.jpg"
   * Used by the sitemap generator for `<image:image>` entries.
   */
  coverImage?: string;
  /**
   * When set, visiting this page's route redirects directly to this URL
   * (typically a `/content-media/…` file URL). Derived at index time from
   * `frontmatter.file` (filename → auto-computed URL) or the explicit
   * `frontmatter.file_url` override. Templates do not need to handle this
   * case — the routing layer issues the redirect transparently.
   */
  fileUrl?: string;
  /**
   * Resolved from `frontmatter.termPageFor`. Stored in the index so the
   * taxonomy API can locate term pages without additional file I/O.
   *
   * Normalised at index time to `Record<vocab, value>` — the simple string
   * form (`termPageFor: ewr`) becomes `{ tag: "ewr" }`.
   */
  termPageFor?: Record<string, string>;
  /**
   * Site-declared custom frontmatter fields extracted at index time for use
   * in facet filtering and counting.
   *
   * Populated from `system.search.facets[].field` in `site.yaml`. Only fields
   * that resolve to a string or string[] are stored here. Dot-paths into
   * nested frontmatter (e.g. "taxonomy.category") are supported.
   *
   * Available to the routing layer for facet resolution without reloading
   * the full page frontmatter.
   */
  extra?: Record<string, string | string[]>;
}

// === Collections ===

/** Declarative collection definition (lives in page frontmatter) */
export interface CollectionDefinition {
  items: CollectionSource;
  order?: {
    by: "date" | "title" | "order" | "random" | string; // string = "custom.field"
    dir?: "asc" | "desc";
  };
  filter?: {
    published?: boolean;
    visible?: boolean;
    routable?: boolean;
    template?: string | string[];
    taxonomy?: Record<string, string | string[]>;
  };
  limit?: number;
  offset?: number;
  pagination?: boolean | { size: number };
}

/** Collection source — where to pull pages from */
export type CollectionSource =
  | { "@self.children": true }
  | { "@self.siblings": true }
  | { "@self.modules": true }
  | { "@self.descendants": true }
  | { "@page.children": string }
  | { "@page.descendants": string }
  | { "@taxonomy.category": string | string[] }
  | { "@taxonomy.tag": string | string[] }
  | { "@taxonomy": Record<string, string | string[]> }
  /** Flex Object type — e.g. `{ "@flex": "products" }` */
  | { "@flex": string }
  /**
   * Frontmatter field reference — resolves pages by slug from a frontmatter
   * array field on the context page.
   *
   * e.g. `{ "@frontmatter": "posts" }` reads `page.frontmatter.posts`, expects
   * each item to be either a slug string or an object with a `slug` property,
   * and returns the pages whose route last-segment matches those slugs.
   * Order is preserved as declared in the frontmatter array.
   */
  | { "@frontmatter": string };

/** Resolved collection with query results */
export interface Collection {
  items: Page[];
  total: number;
  page: number;
  pages: number;
  hasNext: boolean;
  hasPrev: boolean;

  /**
   * Pre-load all collection items asynchronously.
   * Must be called (and awaited) before accessing `items` or `filter()`,
   * otherwise the synchronous `items` getter returns an empty array.
   * The routing layer calls this automatically for template rendering.
   */
  load(): Promise<Page[]>;

  // Chainable modifiers (return new Collection)
  order(by: string, dir?: "asc" | "desc"): Collection;
  filter(fn: (page: Page) => boolean): Collection;
  slice(start: number, end?: number): Collection;
  paginate(size: number, page?: number): Collection;
}

// === Template & Rendering ===

/** Resolved template component (for .md/.mdx pages) */
export type TemplateComponent = (props: TemplateProps) => unknown;

/** Props passed to theme templates (for .md/.mdx pages) */
export interface TemplateProps {
  page: Page;
  /** Pre-formatted page title: "Title - Descriptor | Site Name" */
  pageTitle: string;
  site: SiteConfig;
  config: DuneConfig;
  /** Top-level navigation pages */
  nav: PageIndex[];
  /**
   * Text direction for the page's language.
   * Always provided by the engine — themes can use this to set `dir` on
   * their `<html>` element for RTL language support.
   *
   * @example
   * ```tsx
   * <html lang={page.language} dir={dir}>
   * ```
   */
  dir: "ltr" | "rtl";
  /** Current request pathname (for canonical, hreflang, language switcher) */
  pathname?: string;
  /** Current request query string, e.g. "?submitted=1" (empty string when none) */
  search?: string;
  /** Dynamically loaded layout component (use for hot-reload compatibility) */
  Layout?: TemplateComponent;
  collection?: Collection;
  /**
   * User-controlled theme settings from `data/theme-config.json`.
   * Populated when the active theme declares a `config_schema` in `theme.yaml`.
   * Templates can use these values for colours, feature flags, etc.
   *
   * @example
   * ```tsx
   * const primaryColor = props.themeConfig?.primary_color ?? "#c9a96e";
   * ```
   */
  themeConfig?: Record<string, unknown>;
  /**
   * Present when rendering the built-in `/search` page.
   * The raw query string submitted by the user (decoded).
   */
  searchQuery?: string;
  /**
   * Present when rendering the built-in `/search` page.
   * Ranked results from the full-text search engine.
   * Themes can use this to render a custom search results page
   * instead of the built-in fallback by providing a "search" template.
   */
  searchResults?: Array<{ route: string; title: string; excerpt: string; score: number }>;
  children?: unknown;
}

/** Props passed to .tsx content pages (the component IS the content) */
export interface ContentPageProps {
  site: SiteConfig;
  config: DuneConfig;
  /** The page's own route, e.g. "/blog/hello-world" */
  route: string;
  /** Helper to resolve co-located media URLs */
  media: MediaHelper;
  /** Collection results (if page has collection definition in frontmatter) */
  collection?: Collection;
  /** URL parameters — always empty for content pages (no parameterized routes) */
  params: Record<string, string>;
}

// === Format Handler ===

/** Render context passed to format handlers at request time */
export interface RenderContext {
  /**
   * Site configuration — available at full render time (routes.ts), but
   * intentionally omitted when building a minimal context for index-time
   * markdown rendering (page-loader.ts `buildMinimalRenderContext`).
   * Format handlers must treat this as potentially absent.
   */
  site?: SiteConfig;
  /**
   * Full CMS configuration — same availability caveat as `site`.
   * Format handlers must treat this as potentially absent.
   */
  config?: DuneConfig;
  media: MediaHelper;
  collection?: Collection;
  params: Record<string, string>;
  /**
   * Absolute filesystem path to the content directory root.
   * Used by format handlers (e.g. MDX) to resolve co-located file imports.
   * Available whenever a real content directory is in use.
   */
  contentDir?: string;
  /**
   * Pre-resolved trust flag: true when either site.trusted_html or the
   * page's own frontmatter.trusted_html is set. Format handlers should
   * check this rather than reading site/frontmatter directly.
   */
  trustedHtml?: boolean;
}

/**
 * Pluggable content format handler.
 * Adding new formats is just registering a new handler.
 */
export interface ContentFormatHandler {
  /** File extensions this handler supports (e.g., [".md"], [".tsx"]) */
  extensions: string[];

  /**
   * Extract frontmatter from raw file content.
   * Must be fast — no code execution, used during index building.
   */
  extractFrontmatter(
    raw: string,
    filePath: string,
  ): Promise<PageFrontmatter>;

  /**
   * Extract the raw content body (without frontmatter).
   * For .md: the markdown text after the --- block.
   * For .tsx: null (content is the component itself).
   */
  extractBody(raw: string, filePath: string): string | null;

  /**
   * Render content to HTML string (called at request time).
   * For .md: markdown → HTML.
   * For .tsx: dynamic import → component render.
   */
  renderToHtml(
    page: Page,
    ctx: RenderContext,
  ): Promise<string>;
}

// === Title Helpers ===

/**
 * Build a formatted page title for the <title> tag.
 *
 * Pattern: "Title - Descriptor | Site Name"
 *   - Page with title + descriptor: "Services - Custom Web Solutions | My Site"
 *   - Page with title only:         "Services | My Site"
 *   - Home page (no title):         "My Site"
 */
export function buildPageTitle(
  page: { frontmatter: Pick<PageFrontmatter, "title" | "descriptor"> } | undefined | null,
  siteName: string,
): string {
  if (!page?.frontmatter?.title) return siteName;

  const { title, descriptor } = page.frontmatter;
  const pagePart = descriptor ? `${title} - ${descriptor}` : title;
  return `${pagePart} | ${siteName}`;
}
