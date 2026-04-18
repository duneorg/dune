/**
 * Page loader — creates full lazy Page objects from PageIndex entries.
 *
 * The content index stores lightweight PageIndex entries. When a specific
 * page is requested, the page loader creates a full Page object with lazy
 * accessors for content, HTML, component, relations, and media.
 *
 * Nothing expensive happens until you call page.html(), page.component(),
 * page.children(), etc.
 */

import { dirname, extname, join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import { ContentError, StorageError } from "../core/errors.ts";
import type { StorageAdapter } from "../storage/types.ts";
import type { FormatRegistry } from "./formats/registry.ts";
import { applyOrphanProtection } from "./typography.ts";
import type {
  ContentFormat,
  MediaFile,
  Page,
  PageFrontmatter,
  PageIndex,
  RenderContext,
  TemplateComponent,
} from "./types.ts";
import { dirPathToRoute, effectiveOrder, isMediaFile } from "./path-utils.ts";

export interface PageLoaderOptions {
  storage: StorageAdapter;
  contentDir: string;
  formats: FormatRegistry;
  /** All page indexes (for resolving relations) */
  pages: PageIndex[];
  /** Function to load a page by source path (recursive — for relations) */
  loadPage: (sourcePath: string) => Promise<Page>;
  /** Storage root directory (for resolving absolute paths for dynamic imports) */
  storageRoot?: string;
  /** Apply orphan protection (&nbsp; before last word) to rendered HTML (default: true) */
  orphanProtection?: boolean;
  /** Site configuration — passed into the render context so format handlers
   *  (e.g. the markdown renderer) can read site-level flags like trusted_html. */
  site?: import("../config/types.ts").SiteConfig;
}

/**
 * Load a full Page object from a PageIndex entry.
 */
export async function loadPage(
  index: PageIndex,
  options: PageLoaderOptions,
): Promise<Page> {
  const { storage, contentDir, formats } = options;

  // Find the content file within the source folder
  const contentFilePath = await findContentFile(storage, contentDir, index.sourcePath);
  if (!contentFilePath) {
    throw new ContentError(`Content file not found`, index.sourcePath);
  }

  // Read raw content
  const raw = await storage.readText(contentFilePath);

  // Get the format handler
  const handler = formats.getForFile(contentFilePath);
  if (!handler) {
    throw new ContentError(`No format handler for "${contentFilePath}"`, index.sourcePath);
  }

  // Extract frontmatter and body
  const frontmatter = await handler.extractFrontmatter(raw, contentFilePath);
  const rawContent = handler.extractBody(raw, contentFilePath);

  // Compute the URL prefix for co-located media (based on content directory, not page route)
  const contentDirPath = dirname(index.sourcePath); // e.g. "04.blog/01.post"
  const contentDirRoute = dirPathToRoute(contentDirPath); // e.g. "/blog/post"
  // Discover co-located media
  const media = await discoverMedia(storage, contentDir, index.sourcePath, contentDirRoute);

  // Build the page with lazy accessors
  const page: Page = {
    sourcePath: index.sourcePath,
    route: index.route,
    language: index.language,
    format: index.format,
    template: index.template,
    navTitle: index.navTitle,
    frontmatter,
    rawContent,
    order: index.order,
    depth: index.depth,
    isModule: index.isModule,
    media,

    // Lazy: rendered HTML (for .md and .mdx pages)
    html: lazyOnce(async () => {
      if (index.format !== "md" && index.format !== "mdx") return "";
      const trustedHtml = options.site?.trusted_html === true || frontmatter.trusted_html === true;
      const ctx = buildMinimalRenderContext(media, index.sourcePath, contentDir, options.site, trustedHtml);
      let html = await handler.renderToHtml(page, ctx);
      if (options.orphanProtection !== false) {
        html = applyOrphanProtection(html);
      }
      return html;
    }),

    // Lazy: TSX component (for .tsx pages)
    component: lazyOnce(async () => {
      if (index.format !== "tsx") return null;
      const absPath = await resolveAbsolutePath(options.storageRoot, contentFilePath);
      const mod = await import(`file://${absPath}`);
      return (mod.default ?? null) as TemplateComponent | null;
    }),

    // Lazy: summary/excerpt
    summary: lazyOnce(async () => {
      if (!rawContent) return frontmatter.title || "";
      const size = frontmatter.summary?.size ?? 300;
      // Strip markdown syntax for a plain text excerpt
      const plain = rawContent
        .replace(/^#{1,6}\s+/gm, "")
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/\*([^*]+)\*/g, "$1")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/\n+/g, " ")
        .trim();
      return plain.slice(0, size);
    }),

    // Lazy: relations
    parent: lazyOnce(async () => {
      if (!index.parentPath) return null;
      // Find the page whose folder IS the parent path
      const parent = options.pages.find((p) => {
        const parts = p.sourcePath.split("/");
        const dir = parts.slice(0, -1).join("/");
        return dir === index.parentPath;
      });
      if (!parent) return null;
      return options.loadPage(parent.sourcePath);
    }),

    children: lazyOnce(async () => {
      const myDir = dirname(index.sourcePath);
      const childPages = options.pages.filter((p) => {
        if (p.sourcePath === index.sourcePath) return false;
        const pDir = dirname(p.sourcePath);
        const pParent = dirname(pDir);
        return pParent === myDir && !p.isModule;
      });
      childPages.sort((a, b) => effectiveOrder(a.order) - effectiveOrder(b.order) || a.route.localeCompare(b.route));
      return Promise.all(childPages.map((c) => options.loadPage(c.sourcePath)));
    }),

    siblings: lazyOnce(async () => {
      if (!index.parentPath) return [];
      const siblingPages = options.pages.filter((p) => {
        if (p.sourcePath === index.sourcePath) return false;
        return p.parentPath === index.parentPath && !p.isModule;
      });
      siblingPages.sort((a, b) => effectiveOrder(a.order) - effectiveOrder(b.order) || a.route.localeCompare(b.route));
      return Promise.all(siblingPages.map((s) => options.loadPage(s.sourcePath)));
    }),

    modules: lazyOnce(async () => {
      const myDir = dirname(index.sourcePath);
      const moduleParts = options.pages.filter((p) => {
        if (p.sourcePath === index.sourcePath) return false;
        const pDir = dirname(p.sourcePath);
        const pParent = dirname(pDir);
        return pParent === myDir && p.isModule;
      });
      moduleParts.sort((a, b) => effectiveOrder(a.order) - effectiveOrder(b.order));
      return Promise.all(moduleParts.map((m) => options.loadPage(m.sourcePath)));
    }),
  };

  return page;
}

// === Helpers ===

/**
 * Find the content file within a source path's directory.
 * Source path is like "02.blog/01.hello-world" — we need to find
 * the actual content file (post.md, page.tsx, default.md, etc.)
 */
async function findContentFile(
  storage: StorageAdapter,
  contentDir: string,
  sourcePath: string,
): Promise<string | null> {
  // sourcePath from the index already includes the filename
  // e.g., "01.getting-started/02.quickstart/default.md"
  const fullPath = join(contentDir, sourcePath);
  if (await storage.exists(fullPath)) {
    return fullPath;
  }
  return null;
}

/**
 * Resolve an absolute filesystem path for dynamic imports.
 * Uses the storage root to construct the full path.
 */
async function resolveAbsolutePath(
  storageRoot: string | undefined,
  relativePath: string,
): Promise<string> {
  // Try: storageRoot + relativePath (most common case)
  if (storageRoot) {
    try {
      return await Deno.realPath(join(storageRoot, relativePath));
    } catch {
      // Fall through to other attempts
    }
  }

  // Try: relativePath directly (works if storage root is CWD)
  try {
    return await Deno.realPath(relativePath);
  } catch {
    // Try: CWD + relativePath
    return await Deno.realPath(join(Deno.cwd(), relativePath));
  }
}

/**
 * Discover co-located media files for a page.
 */
async function discoverMedia(
  storage: StorageAdapter,
  contentDir: string,
  sourcePath: string,
  dirRoute: string,
): Promise<MediaFile[]> {
  const dir = join(contentDir, dirname(sourcePath));
  const media: MediaFile[] = [];

  try {
    const entries = await storage.list(dir);
    for (const entry of entries) {
      if (!entry.isFile) continue;
      if (!isMediaFile(entry.name)) continue;

      const mediaPath = join(dir, entry.name);
      const stat = await storage.stat(mediaPath);

      // Determine MIME type from extension
      const mimeType = getMimeType(entry.name);

      // Build the served URL using the route-based path
      const url = `${dirRoute}/${entry.name}`;

      // Check for sidecar metadata
      let meta: Record<string, unknown> = {};
      const sidecarPath = join(dir, `${entry.name}.meta.yaml`);
      try {
        if (await storage.exists(sidecarPath)) {
          const text = await storage.readText(sidecarPath);
          const parsed = parseYaml(text);
          if (parsed && typeof parsed === "object") {
            meta = parsed as Record<string, unknown>;
          }
        }
      } catch {
        // Sidecar parse error — skip
      }

      media.push({
        name: entry.name,
        path: mediaPath,
        type: mimeType,
        size: stat.size,
        meta,
        url,
      });
    }
  } catch (err) {
    // A "directory not found" error is expected — the page's folder simply has
    // no media files (or the folder doesn't exist yet).  Any other error
    // (permissions failure, KV-storage error, filesystem corruption, etc.) is
    // unexpected and should be surfaced so it doesn't silently corrupt the
    // media list.
    const isNotFound =
      err instanceof StorageError && err.message.startsWith("Directory not found");
    if (!isNotFound) {
      console.warn(`[dune] discoverMedia: unexpected error for "${sourcePath}": ${err}`);
    }
  }

  return media;
}

/** Build a minimal RenderContext for markdown rendering. */
function buildMinimalRenderContext(
  media: MediaFile[],
  sourcePath: string,
  _contentDir: string,
  site?: import("../config/types.ts").SiteConfig,
  trustedHtml?: boolean,
): RenderContext {
  return {
    site,
    trustedHtml,
    media: {
      url: (filename: string) => {
        const file = media.find((m) => m.name === filename);
        if (file) return file.url;
        const dirRoute = dirPathToRoute(dirname(sourcePath));
        return `${dirRoute}/${filename}`;
      },
      get: (filename: string) => media.find((m) => m.name === filename) ?? null,
      list: () => media,
    },
    params: {},
  };
}

/**
 * Create a lazy-once async function (memoized).
 *
 * On success the resolved value is cached forever.
 * On failure the cache is cleared so the next call retries — important for
 * dev mode where a file error (parse error, missing file) may be transient
 * and should re-attempt after the file is corrected.
 */
function lazyOnce<T>(fn: () => Promise<T>): () => Promise<T> {
  let cached: Promise<T> | null = null;
  return () => {
    if (!cached) {
      cached = fn().catch((err) => {
        cached = null; // Allow retry on next call
        throw err;
      });
    }
    return cached;
  };
}

/**
 * Basic MIME type lookup by filename (or path) extension.
 * Exported so callers (e.g. core/engine.ts serveMedia) can reuse
 * the single source-of-truth table instead of maintaining a duplicate.
 */
export function getMimeType(filename: string): string {
  const ext = extname(filename).toLowerCase();
  const types: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".svg": "image/svg+xml",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".ogg": "video/ogg",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".pdf": "application/pdf",
    ".zip": "application/zip",
    ".json": "application/json",
    ".csv": "text/csv",
  };
  return types[ext] ?? "application/octet-stream";
}
