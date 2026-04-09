/**
 * Content index builder — scans content directory and builds the PageIndex.
 *
 * This is the heart of Dune's performance story:
 *   - Scans content directory once, parses ALL frontmatter (not body)
 *   - Produces a lightweight PageIndex[] for routing, collections, taxonomy
 *   - Incremental updates: only reparse changed files (mtime/hash comparison)
 *   - Never loads full page content — that's lazy, on-demand
 *
 * Format-aware indexing:
 *   - .md / .mdx → Parse YAML frontmatter between --- delimiters
 *   - .tsx → Fast path: read .frontmatter.yaml sidecar. Fallback: AST extract.
 */

import { ContentError } from "../core/errors.ts";
import type { StorageAdapter, StorageEntry } from "../storage/types.ts";
import type { ContentFormat, PageFrontmatter, PageIndex } from "./types.ts";
import type { FormatRegistry } from "./formats/registry.ts";
import type { BlueprintMap } from "../blueprints/types.ts";
import { validateFrontmatter } from "../blueprints/validator.ts";
import {
  calculateDepth,
  dirPathToRoute,
  getParentPath,
  isContentFile,
  isInDraftsFolder,
  isInModuleFolder,
  isMediaFile,
  isMetadataFile,
  parseContentFilename,
  parseFolderName,
  sourcePathToRoute,
} from "./path-utils.ts";

export interface IndexBuilderOptions {
  /** Storage adapter for reading files */
  storage: StorageAdapter;
  /** Content directory path (relative to storage root) */
  contentDir: string;
  /** Format handler registry */
  formats: FormatRegistry;
  /** Explicit home page slug from config (overrides autodetect) */
  siteHome?: string;
  /** Supported language codes for i18n (e.g. ["en", "de", "fr"]) */
  supportedLanguages?: string[];
  /** Default language for files without suffix (from config) */
  defaultLanguage?: string;
  /**
   * Blueprint map for frontmatter validation.
   * When provided, each page's frontmatter is validated against the blueprint
   * matching its template name.  Violations are added to BuildResult.errors
   * (non-fatal — the page is still indexed).
   */
  blueprints?: BlueprintMap;
}

export interface BuildResult {
  /** The built page index */
  pages: PageIndex[];
  /** Taxonomy reverse index: { tag: { deno: ["path1", "path2"] } } */
  taxonomyMap: TaxonomyMap;
  /** Number of files scanned */
  scanned: number;
  /** Number of pages indexed */
  indexed: number;
  /** Errors encountered (non-fatal) */
  errors: IndexError[];
  /** Build duration in milliseconds */
  duration: number;
  /** Detected or configured home page slug (e.g., "home", "efficiency") */
  homeSlug: string;
}

export interface IndexError {
  path: string;
  message: string;
}

/** Taxonomy reverse index */
export type TaxonomyMap = Record<string, Record<string, string[]>>;

/**
 * Build a complete content index from scratch.
 */
export async function buildIndex(
  options: IndexBuilderOptions,
): Promise<BuildResult> {
  const start = performance.now();
  const { storage, contentDir, formats, siteHome, supportedLanguages, defaultLanguage, blueprints } = options;
  const defaultLang = defaultLanguage ?? "en";

  const pages: PageIndex[] = [];
  const taxonomyMap: TaxonomyMap = {};
  const errors: IndexError[] = [];
  let scanned = 0;

  // Recursively scan the content directory
  let entries: StorageEntry[];
  try {
    entries = await storage.listRecursive(contentDir);
  } catch (err) {
    throw new ContentError(
      `Failed to scan content directory "${contentDir}": ${err}`,
    );
  }

  // Process each file
  for (const entry of entries) {
    scanned++;

    // Skip directories, metadata files, and non-content files
    if (!entry.isFile) continue;
    if (isMetadataFile(entry.name)) continue;
    if (isMediaFile(entry.name)) continue;
    if (!isContentFile(entry.name)) continue;

    // Skip files in _drafts folders
    const relativePath = stripContentDir(entry.path, contentDir);
    if (isInDraftsFolder(relativePath)) continue;

    // Parse content filename (with language variant detection when i18n configured)
    const fileInfo = parseContentFilename(entry.name, supportedLanguages);
    if (!fileInfo) continue;

    // Get the format handler
    const handler = formats.get(fileInfo.ext);
    if (!handler) {
      errors.push({
        path: entry.path,
        message: `No format handler registered for ${fileInfo.ext}`,
      });
      continue;
    }

    try {
      // Get file stats for mtime
      const stat = await storage.stat(entry.path);

      // Read file content for frontmatter extraction
      const raw = await storage.readText(entry.path);

      // Extract frontmatter (fast — no body parsing/rendering)
      const frontmatter = await handler.extractFrontmatter(raw, entry.path);

      // Build the page index entry
      const pageIndex = buildPageIndex(
        relativePath,
        fileInfo.format,
        fileInfo.template,
        frontmatter,
        stat.mtime,
        raw,
        fileInfo.language ?? defaultLang,
      );

      if (pageIndex) {
        pages.push(pageIndex);

        // Update taxonomy map
        if (frontmatter.taxonomy) {
          updateTaxonomyMap(taxonomyMap, frontmatter.taxonomy, pageIndex.sourcePath);
        }

        // Validate frontmatter against blueprint (non-fatal)
        if (blueprints) {
          const bpErrors = validateFrontmatter(frontmatter, pageIndex.template, blueprints);
          for (const e of bpErrors) {
            errors.push({
              path: entry.path,
              message: `[${pageIndex.template} blueprint] ${e.field}: ${e.message}`,
            });
          }
        }
      }
    } catch (err) {
      errors.push({
        path: entry.path,
        message: `${err}`,
      });
    }
  }

  // Sort pages by route for consistent ordering
  pages.sort((a, b) => a.route.localeCompare(b.route));

  // Deduplicate routes: directory-based pages win over flat files.
  const finalPages = deduplicateRoutes(pages);

  const duration = performance.now() - start;
  const homeSlug = siteHome ?? detectHomeSlug(finalPages);

  return {
    pages: finalPages,
    taxonomyMap,
    scanned,
    indexed: finalPages.length,
    errors,
    duration,
    homeSlug,
  };
}

/**
 * Incrementally update the index with changed files.
 * Compares mtime to detect changes.
 */
export async function updateIndex(
  existingPages: PageIndex[],
  existingTaxonomy: TaxonomyMap,
  options: IndexBuilderOptions,
): Promise<BuildResult> {
  const start = performance.now();
  const { storage, contentDir, formats, siteHome, supportedLanguages, defaultLanguage, blueprints } = options;
  const defaultLang = defaultLanguage ?? "en";

  // Build a map of existing pages by sourcePath
  const existing = new Map<string, PageIndex>();
  for (const page of existingPages) {
    existing.set(page.sourcePath, page);
  }

  const pages: PageIndex[] = [];
  const taxonomyMap: TaxonomyMap = {};
  const errors: IndexError[] = [];
  let scanned = 0;
  let reindexed = 0;

  let entries: StorageEntry[];
  try {
    entries = await storage.listRecursive(contentDir);
  } catch (err) {
    throw new ContentError(
      `Failed to scan content directory "${contentDir}": ${err}`,
    );
  }

  // Track which paths are still present (for detecting deletions)
  const currentPaths = new Set<string>();

  for (const entry of entries) {
    scanned++;

    if (!entry.isFile) continue;
    if (isMetadataFile(entry.name)) continue;
    if (isMediaFile(entry.name)) continue;
    if (!isContentFile(entry.name)) continue;

    const relativePath = stripContentDir(entry.path, contentDir);
    if (isInDraftsFolder(relativePath)) continue;

    const fileInfo = parseContentFilename(entry.name, supportedLanguages);
    if (!fileInfo) continue;

    currentPaths.add(relativePath);

    // Check if file has changed.
    // Note: mtime comparison has known precision limits —
    //   • FAT32/HFS+: 2-second resolution, so two saves within the same
    //     2-second window may not be detected as changed.
    //   • Virtual filesystems / network shares: mtime may be 0 (see fs.ts
    //     stat() for rationale), in which case both values are 0 and the
    //     file is treated as unchanged until a hash-aware comparison is added.
    const stat = await storage.stat(entry.path);
    const existingPage = existing.get(relativePath);

    if (existingPage && existingPage.mtime === stat.mtime) {
      // Unchanged — reuse existing index entry
      pages.push(existingPage);

      // Rebuild taxonomy from existing data
      if (existingPage.taxonomy) {
        updateTaxonomyMap(taxonomyMap, existingPage.taxonomy, existingPage.sourcePath);
      }
      continue;
    }

    // Changed or new — reindex
    reindexed++;
    const handler = formats.get(fileInfo.ext);
    if (!handler) {
      errors.push({
        path: entry.path,
        message: `No format handler registered for ${fileInfo.ext}`,
      });
      continue;
    }

    try {
      const raw = await storage.readText(entry.path);
      const frontmatter = await handler.extractFrontmatter(raw, entry.path);

      const pageIndex = buildPageIndex(
        relativePath,
        fileInfo.format,
        fileInfo.template,
        frontmatter,
        stat.mtime,
        raw,
        fileInfo.language ?? defaultLang,
      );

      if (pageIndex) {
        pages.push(pageIndex);
        if (frontmatter.taxonomy) {
          updateTaxonomyMap(taxonomyMap, frontmatter.taxonomy, pageIndex.sourcePath);
        }

        // Validate frontmatter against blueprint (non-fatal)
        if (blueprints) {
          const bpErrors = validateFrontmatter(frontmatter, pageIndex.template, blueprints);
          for (const e of bpErrors) {
            errors.push({
              path: entry.path,
              message: `[${pageIndex.template} blueprint] ${e.field}: ${e.message}`,
            });
          }
        }
      }
    } catch (err) {
      errors.push({ path: entry.path, message: `${err}` });
    }
  }

  pages.sort((a, b) => a.route.localeCompare(b.route));

  // Deduplicate routes: directory-based pages win over flat files.
  const finalPages = deduplicateRoutes(pages);

  const duration = performance.now() - start;
  const homeSlug = siteHome ?? detectHomeSlug(finalPages);

  return {
    pages: finalPages,
    taxonomyMap,
    scanned,
    indexed: finalPages.length,
    errors,
    duration,
    homeSlug,
  };
}

// === Internal helpers ===

/** Check whether a sourcePath is a flat-file (filename stem has a numeric prefix). */
function isFlatFilePath(sp: string): boolean {
  const parts = sp.split("/");
  const fn = parts[parts.length - 1];
  const stem = fn.slice(0, fn.lastIndexOf(".") >= 0 ? fn.lastIndexOf(".") : fn.length);
  return /^\d+\./.test(stem);
}

/**
 * Deduplicate routable pages by route.
 * Directory-based pages (non-flat) win over flat-file pages when routes collide.
 * Among same-type collisions the first-encountered page wins.
 */
function deduplicateRoutes(pages: PageIndex[]): PageIndex[] {
  const nonRoutable: PageIndex[] = [];
  // Key is "route::language" — multilingual variants share a route but differ
  // by language, which is intentional and not a collision.
  const routeMap = new Map<string, PageIndex>();

  for (const page of pages) {
    if (!page.route) {
      nonRoutable.push(page);
      continue;
    }
    const key = `${page.route}::${page.language}`;
    const existing = routeMap.get(key);
    if (existing) {
      const existingIsFlat = isFlatFilePath(existing.sourcePath);
      const newIsFlat = isFlatFilePath(page.sourcePath);
      if (!existingIsFlat && newIsFlat) {
        // Existing directory-based page wins
        console.warn(`[dune] Route collision: "${page.sourcePath}" and "${existing.sourcePath}" both produce route "${page.route}". Directory-based page wins.`);
      } else if (existingIsFlat && !newIsFlat) {
        // New directory-based page wins — replace
        console.warn(`[dune] Route collision: "${page.sourcePath}" and "${existing.sourcePath}" both produce route "${page.route}". Directory-based page wins.`);
        routeMap.set(key, page);
      } else {
        // Both same type — keep first
        console.warn(`[dune] Route collision: "${page.sourcePath}" and "${existing.sourcePath}" both produce route "${page.route}". Keeping first.`);
      }
    } else {
      routeMap.set(key, page);
    }
  }

  const result = [...nonRoutable, ...routeMap.values()];
  result.sort((a, b) => a.route.localeCompare(b.route));
  return result;
}

/** Build a single PageIndex entry from parsed data. */
function buildPageIndex(
  sourcePath: string,
  format: ContentFormat,
  defaultTemplate: string,
  frontmatter: PageFrontmatter,
  mtime: number,
  rawContent: string,
  language: string,
): PageIndex | null {
  const isModule = isInModuleFolder(sourcePath);

  // Determine route
  const route = sourcePathToRoute(sourcePath, frontmatter.slug);

  // Non-routable pages (modules, etc.) still get indexed for collection queries
  // but with an empty route
  const finalRoute = route ?? "";

  // Determine order: flat files use their own numeric prefix; directory-based use folder prefix
  const parts = sourcePath.split("/");
  const filename = parts[parts.length - 1];
  const filenameStem = filename.slice(0, filename.lastIndexOf(".") >= 0 ? filename.lastIndexOf(".") : filename.length);
  const flatMatch = filenameStem.match(/^(\d+)\.(.*)/);
  const folderName = parts.length > 1 ? parts[parts.length - 2] : "";
  const folderInfo = parseFolderName(folderName);
  const order = frontmatter.order != null
    ? frontmatter.order
    : flatMatch ? parseInt(flatMatch[1], 10) : folderInfo.order;

  // Template: frontmatter override > filename convention
  const template = frontmatter.template ?? defaultTemplate;

  // Compute a hash of the frontmatter for change detection
  const hash = computeHash(JSON.stringify(frontmatter));

  return {
    sourcePath,
    route: finalRoute,
    language,
    format,
    template,
    title: frontmatter.title || "",
    navTitle: frontmatter.nav_title || frontmatter.title || "",
    // @std/yaml (and most YAML parsers) parse bare date values like
    // `date: 2025-06-15` as JS Date objects, not strings.  The PageFrontmatter
    // type declares `date?: string` but the runtime value may be a Date.  Cast
    // through `unknown` so we can perform the runtime check and coerce to an
    // ISO date string ("YYYY-MM-DD"), ensuring PageIndex.date is always
    // string|null as declared regardless of parser behaviour.
    date: (frontmatter.date as unknown) instanceof Date
      ? (frontmatter.date as unknown as Date).toISOString().slice(0, 10)
      : (frontmatter.date ?? null),
    published: frontmatter.published ?? true,
    status: inferStatus(frontmatter),
    visible: frontmatter.visible ?? true,
    routable: frontmatter.routable ?? true,
    isModule,
    order,
    depth: calculateDepth(sourcePath),
    parentPath: getParentPath(sourcePath),
    taxonomy: frontmatter.taxonomy ?? {},
    mtime,
    hash,
    coverImage: buildCoverImageUrl(sourcePath, frontmatter.image as string | undefined),
    fileUrl: buildFileUrl(sourcePath, frontmatter.file as string | undefined, frontmatter.file_url as string | undefined),
  };
}

/** Update the taxonomy reverse index. */
function updateTaxonomyMap(
  map: TaxonomyMap,
  taxonomy: Record<string, string[]>,
  sourcePath: string,
): void {
  for (const [taxName, values] of Object.entries(taxonomy)) {
    if (!map[taxName]) map[taxName] = {};

    const valArray = Array.isArray(values) ? values : [values];
    for (const val of valArray) {
      const strVal = String(val);
      if (!map[taxName][strVal]) map[taxName][strVal] = [];
      if (!map[taxName][strVal].includes(sourcePath)) {
        map[taxName][strVal].push(sourcePath);
      }
    }
  }
}

/** Strip the content directory prefix from a path. */
function stripContentDir(path: string, contentDir: string): string {
  if (path.startsWith(contentDir + "/")) {
    return path.slice(contentDir.length + 1);
  }
  return path;
}

/** Infer workflow status from frontmatter. */
function inferStatus(
  frontmatter: PageFrontmatter,
): "draft" | "in_review" | "published" | "archived" {
  // Explicit status takes precedence
  const status = frontmatter.status;
  if (
    status === "draft" || status === "in_review" ||
    status === "published" || status === "archived"
  ) {
    return status;
  }
  // Infer from published flag
  return (frontmatter.published ?? true) ? "published" : "draft";
}

/**
 * Detect the home page slug from content structure.
 *
 * Finds the first ordered top-level folder (lowest numeric prefix > 0).
 * Falls back to "home" if no ordered folders are found (backward compatibility).
 */
export function detectHomeSlug(pages: PageIndex[]): string {
  // Find top-level pages with explicit ordering
  const ordered = pages
    .filter((p) => p.depth === 0 && p.order > 0)
    .sort((a, b) => a.order - b.order);

  if (ordered.length > 0) {
    // Extract the folder slug from the first ordered page's sourcePath
    const parts = ordered[0].sourcePath.split("/");
    if (parts.length > 0) {
      const info = parseFolderName(parts[0]);
      return info.slug;
    }
  }

  // Fallback for backward compatibility
  return "home";
}

/**
 * Derive the cover image URL from the page's `image` frontmatter field.
 *
 * The image field is expected to be a filename (e.g. "cover.jpg") co-located
 * with the content file. The URL is built from the route-based path for the
 * page's directory (numeric prefixes stripped).
 *
 * @example
 *   sourcePath: "02.blog/01.post/default.md"
 *   image: "cover.jpg"
 *   → "/blog/post/cover.jpg"
 */
function buildCoverImageUrl(sourcePath: string, image: string | undefined): string | undefined {
  if (!image || typeof image !== "string") return undefined;
  const dir = sourcePath.split("/").slice(0, -1).join("/");
  if (!dir) return undefined;
  return `${dirPathToRoute(dir)}/${image}`;
}

/**
 * Derive the file redirect URL for a file-type page.
 *
 * Accepts either:
 *   - `file` frontmatter (filename only) → auto-computes `/{route-prefix}/{file}`
 *   - `file_url` frontmatter (explicit URL) → used as-is (backward compat)
 *
 * `file` takes precedence over `file_url` when both are present.
 */
function buildFileUrl(
  sourcePath: string,
  file: string | undefined,
  fileUrl: string | undefined,
): string | undefined {
  if (file && typeof file === "string") {
    const dir = sourcePath.split("/").slice(0, -1).join("/");
    if (!dir) return undefined;
    return `${dirPathToRoute(dir)}/${file}`;
  }
  if (fileUrl && typeof fileUrl === "string") {
    return fileUrl;
  }
  return undefined;
}

/** Compute a simple hash of a string for change detection. */
function computeHash(input: string): string {
  // Use a simple hash for v0.1 — not crypto-strength, just change detection
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32-bit int
  }
  return hash.toString(36);
}
