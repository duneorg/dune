/**
 * Path utilities for Dune's folder-based content model.
 *
 * Folder conventions:
 *   01.name/  → ordered + visible in nav, number stripped from URL
 *   name/     → unordered, hidden from nav
 *   _name/    → modular section, non-routable
 *   _drafts/  → non-routable container
 */

import { basename, dirname } from "@std/path";
import type { ContentFormat } from "./types.ts";

/** Known content file extensions mapped to their format */
const FORMAT_MAP: Record<string, ContentFormat> = {
  ".md": "md",
  ".tsx": "tsx",
  ".mdx": "mdx",
};

/** Non-content file extensions (media, metadata, etc.) */
const MEDIA_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif", ".svg",
  ".mp4", ".webm", ".ogg", ".mp3", ".wav",
  ".pdf", ".zip", ".json", ".csv", ".html",
]);

/**
 * Parse a folder name into its components.
 *
 * Examples:
 *   "01.blog"   → { order: 1, slug: "blog", isModule: false, isDraft: false }
 *   "blog"      → { order: 0, slug: "blog", isModule: false, isDraft: false }
 *   "_sidebar"  → { order: 0, slug: "sidebar", isModule: true, isDraft: false }
 *   "_drafts"   → { order: 0, slug: "drafts", isModule: false, isDraft: true }
 */
export interface FolderInfo {
  /** Numeric order (0 if no prefix) */
  order: number;
  /** URL-safe slug (prefix stripped) */
  slug: string;
  /** Whether this is a modular section (_prefix) */
  isModule: boolean;
  /** Whether this is a drafts folder */
  isDraft: boolean;
  /** The original folder name */
  raw: string;
}

export function parseFolderName(name: string): FolderInfo {
  const raw = name;

  // Check for module prefix
  if (name.startsWith("_")) {
    const slug = name.slice(1);
    return {
      order: 0,
      slug,
      isModule: slug !== "drafts",
      isDraft: slug === "drafts",
      raw,
    };
  }

  // Check for numeric prefix: "01.name" or "1.name"
  const numMatch = name.match(/^(\d+)\.(.*)/);
  if (numMatch) {
    return {
      order: parseInt(numMatch[1], 10),
      slug: numMatch[2],
      isModule: false,
      isDraft: false,
      raw,
    };
  }

  // Plain folder name
  return {
    order: 0,
    slug: name,
    isModule: false,
    isDraft: false,
    raw,
  };
}

/**
 * Parse a content filename to extract format, template name, and optional language.
 *
 * Examples:
 *   "default.md"      → { template: "default", format: "md", ext: ".md" }
 *   "default.de.md"   → { template: "default", format: "md", ext: ".md", language: "de" }  (when "de" in supportedLanguages)
 *   "post.md"         → { template: "post", format: "md", ext: ".md" }
 *   "page.tsx"        → { template: "self", format: "tsx", ext: ".tsx" }
 */
export interface FileInfo {
  /** Template name (for .md/.mdx) or "self" (for .tsx) */
  template: string;
  /** Content format */
  format: ContentFormat;
  /** File extension (with dot) */
  ext: string;
  /** Original filename */
  raw: string;
  /** Language code when filename matches {template}.{lang}.{ext} and lang is supported */
  language?: string;
}

export function parseContentFilename(
  name: string,
  supportedLanguages?: string[],
): FileInfo | null {
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex === -1) return null;

  const ext = name.slice(dotIndex);
  const format = FORMAT_MAP[ext];
  if (!format) return null;

  const baseName = name.slice(0, dotIndex);

  // Strip numeric prefix from filename stem for flat pages (e.g. "01.my-article" → "my-article")
  const numMatch = baseName.match(/^(\d+)\.(.*)/);
  const templateBase = numMatch ? numMatch[2] : baseName;

  // Check for language variant: {template}.{lang} when lang is in supported list
  if (supportedLanguages && supportedLanguages.length > 0 && format !== "tsx") {
    const lastDot = templateBase.lastIndexOf(".");
    if (lastDot !== -1) {
      const possibleLang = templateBase.slice(lastDot + 1);
      const template = templateBase.slice(0, lastDot);
      if (
        possibleLang.length >= 2 &&
        supportedLanguages.includes(possibleLang.toLowerCase())
      ) {
        return {
          template,
          format,
          ext,
          raw: name,
          language: possibleLang.toLowerCase(),
        };
      }
    }
  }

  return {
    template: format === "tsx" ? "self" : templateBase,
    format,
    ext,
    raw: name,
  };
}

/**
 * Convert a content directory path to a URL route prefix.
 * Strips numeric prefixes from each segment.
 *
 * Examples:
 *   "04.blog/01.post"  → "/blog/post"
 *   "04.blog"          → "/blog"
 *   ""                 → ""
 */
export function dirPathToRoute(dirPath: string): string {
  if (!dirPath || dirPath === "." || dirPath === "") return "";
  return "/" + dirPath.split("/")
    .filter(Boolean)
    .map((seg) => parseFolderName(seg).slug)
    .join("/");
}

/**
 * Check if a filename is a content file (has a known content extension).
 */
export function isContentFile(name: string): boolean {
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex === -1) return false;
  return name.slice(dotIndex) in FORMAT_MAP;
}

/**
 * Check if a filename is a media file.
 */
export function isMediaFile(name: string): boolean {
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex === -1) return false;
  return MEDIA_EXTENSIONS.has(name.slice(dotIndex).toLowerCase());
}

/**
 * Check if a filename is a metadata sidecar file.
 * Patterns: "cover.jpg.meta.yaml", "page.frontmatter.yaml"
 */
export function isMetadataFile(name: string): boolean {
  return name.endsWith(".meta.yaml") || name.endsWith(".frontmatter.yaml");
}

/**
 * Filename stems that mean "this folder is the page" — do not contribute to
 * the route as an additional segment.
 */
export const RESERVED_STEMS = new Set(["default", "index"]);

/**
 * Returns true when a content file's filename stem should contribute an extra
 * route segment (flat content file), rather than acting as a template selector
 * for the parent folder's page.
 *
 * A file is a non-reserved flat file when ALL of these hold:
 *   - It has a parent directory (not a root-level file)
 *   - The parent directory has NO numeric prefix (plain folder, not a "page folder")
 *   - The filename stem has no numeric prefix (not already a numeric flat page)
 *   - The stem is not a reserved name ("default", "index")
 *
 * Examples:
 *   "articles/my-article.md"          → true  (routes to /articles/my-article)
 *   "articles/default.md"             → false (routes to /articles — reserved stem)
 *   "02.blog/01.hello-world/post.md"  → false (numeric parent → template selector)
 *   "02.blog/post.md"                 → false (numeric parent → template selector)
 */
export function isNonReservedFlatFile(sourcePath: string): boolean {
  const parts = sourcePath.split("/");
  if (parts.length < 2) return false;

  const filename = parts[parts.length - 1];
  const dotIndex = filename.lastIndexOf(".");
  if (dotIndex === -1) return false;
  const stem = filename.slice(0, dotIndex);

  if (/^\d+\./.test(stem)) return false;
  if (RESERVED_STEMS.has(stem)) return false;

  const parentInfo = parseFolderName(parts[parts.length - 2]);
  return parentInfo.order === 0;
}

/**
 * Build a URL route from a source path.
 *
 * Strips numeric prefixes from folders, skips module folders,
 * and produces a clean URL path.
 *
 * Two kinds of flat files contribute a stem segment to the route:
 *   1. Numeric-prefixed stems ("01.my-article.md") — always a route segment.
 *   2. Non-reserved stems in a plain (non-numeric) parent folder — see
 *      `isNonReservedFlatFile`. These are flat content files in an archive
 *      directory (e.g. "articles/") where each file is a separate page.
 *
 * Files with reserved stems ("default", "index") or inside numeric-prefixed
 * "page folders" are template selectors: they define the page for the parent
 * folder and do not add a segment of their own.
 *
 * Examples:
 *   "01.home/default.md"              → "/home"
 *   "01.efficiency/default.md"        → "/efficiency"
 *   "02.blog/01.hello-world/post.md"  → "/blog/hello-world"  (numeric parent)
 *   "02.blog/post.md"                 → "/blog"              (numeric parent)
 *   "articles/my-article.md"          → "/articles/my-article"
 *   "articles/default.md"             → "/articles"
 *   "_sidebar/item.md"                → null (non-routable)
 *
 * Note: Home page mapping (which route serves as "/") is handled by the
 * route resolver via config, not here. This function produces natural routes.
 */
export function sourcePathToRoute(
  sourcePath: string,
  frontmatterSlug?: string,
): string | null {
  const parts = sourcePath.split("/");
  const segments: string[] = [];
  let hasModule = false;
  let hasDraft = false;

  // Process directory parts (everything except the filename)
  for (let i = 0; i < parts.length - 1; i++) {
    const info = parseFolderName(parts[i]);
    if (info.isDraft) {
      hasDraft = true;
      break;
    }
    if (info.isModule) {
      hasModule = true;
      break;
    }
    segments.push(info.slug);
  }

  // Drafts and modules are non-routable
  if (hasDraft || hasModule) return null;

  const filename = parts[parts.length - 1];
  const filenameStem = filename.slice(0, filename.lastIndexOf(".") >= 0 ? filename.lastIndexOf(".") : filename.length);

  // Numeric-prefixed filename stem: always contributes a route segment.
  const flatMatch = filenameStem.match(/^(\d+)\.(.*)/);
  if (flatMatch) {
    segments.push(frontmatterSlug ?? flatMatch[2]);
  } else if (isNonReservedFlatFile(sourcePath)) {
    // Non-reserved stem in a plain parent folder: flat content file.
    // Stem (or slug) becomes an additional route segment.
    segments.push(frontmatterSlug ?? filenameStem);
  } else {
    // Reserved stem or numeric parent folder: template selector.
    // The file defines the page for its parent folder; slug (if any) overrides
    // the last directory segment.
    if (frontmatterSlug) segments[segments.length - 1] = frontmatterSlug;
  }

  // Build the route
  const route = "/" + segments.join("/");

  return route;
}

/**
 * Calculate page depth from source path.
 * Depth 0 = direct child of content root.
 */
export function calculateDepth(sourcePath: string): number {
  const parts = sourcePath.split("/");
  // Subtract 1 for the filename
  return Math.max(0, parts.length - 2);
}

/**
 * Get the parent source path from a content file path.
 * Returns null for top-level pages.
 *
 * Example: "02.blog/01.hello/post.md" → "02.blog"
 */
export function getParentPath(sourcePath: string): string | null {
  const dir = dirname(sourcePath);
  if (dir === "." || dir === "") return null;

  const parentDir = dirname(dir);
  if (parentDir === "." || parentDir === "") return null;

  return parentDir;
}

/**
 * Effective sort order for a page.
 *
 * Pages without a numeric prefix have `order: 0`.  Treating 0 arithmetically
 * would sort them before `01.` pages, which is wrong.  This helper maps 0 →
 * MAX_SAFE_INTEGER so unprefixed items always sort after explicitly-ordered ones.
 *
 * Two unprefixed items both produce MAX_SAFE_INTEGER and compare as equal-order,
 * falling through to the secondary sort key (usually route).
 */
export function effectiveOrder(order: number): number {
  return order > 0 ? order : Number.MAX_SAFE_INTEGER;
}

/**
 * Check if a path segment indicates it's within a drafts folder.
 */
export function isInDraftsFolder(sourcePath: string): boolean {
  return sourcePath.split("/").some((part) => part === "_drafts");
}

/**
 * Check if a path segment indicates it's within a modular section.
 */
export function isInModuleFolder(sourcePath: string): boolean {
  return sourcePath.split("/").some(
    (part) => part.startsWith("_") && part !== "_drafts",
  );
}
