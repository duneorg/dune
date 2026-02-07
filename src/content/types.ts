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
  slug?: string;
  template?: string;
  /** Layout control (TSX content files): string = named layout, false = no layout */
  layout?: string | false;
  published?: boolean;
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
  custom?: Record<string, unknown>;
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

/** A fully resolved page object (loaded on demand) */
export interface Page {
  /** Unique path relative to content root: "02.blog/01.hello-world" */
  sourcePath: string;
  /** URL slug: "/blog/hello-world" */
  route: string;
  /** Content format: "md", "tsx", or "mdx" */
  format: ContentFormat;
  /** Resolved template name: "post" (for .md/.mdx) or "self" (for .tsx) */
  template: string;
  /** Parsed frontmatter */
  frontmatter: PageFrontmatter;
  /** Raw markdown body — only for .md/.mdx (not rendered — lazy) */
  rawContent: string | null;
  /** Rendered HTML (lazy, cached) — for .md/.mdx pages */
  html: () => Promise<string>;
  /** JSX render function — for .tsx pages (dynamically imported) */
  component: () => Promise<TemplateComponent | null>;
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
}

/** Lightweight page reference for the content index (never loads full content) */
export interface PageIndex {
  sourcePath: string;
  route: string;
  /** Content format */
  format: ContentFormat;
  template: string;
  title: string;
  date: string | null;
  published: boolean;
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
  | { "@taxonomy": Record<string, string | string[]> };

/** Resolved collection with query results */
export interface Collection {
  items: Page[];
  total: number;
  page: number;
  pages: number;
  hasNext: boolean;
  hasPrev: boolean;

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
  site: SiteConfig;
  config: DuneConfig;
  collection?: Collection;
  children?: unknown;
}

/** Props passed to .tsx content pages (the component IS the content) */
export interface ContentPageProps {
  site: SiteConfig;
  config: DuneConfig;
  /** Helper to resolve co-located media URLs */
  media: MediaHelper;
  /** Collection results (if page has collection definition in frontmatter) */
  collection?: Collection;
  /** URL parameters */
  params: Record<string, string>;
}

// === Format Handler ===

/** Render context passed to format handlers at request time */
export interface RenderContext {
  site: SiteConfig;
  config: DuneConfig;
  media: MediaHelper;
  collection?: Collection;
  params: Record<string, string>;
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
