/**
 * DuneEngine — orchestrates the entire CMS.
 *
 * Wires together: storage, config, content index, page loader,
 * route resolver, theme loader.
 *
 * This is the single entry point that Fresh routes use to
 * resolve URLs, load pages, and render content.
 */

import { join, dirname } from "@std/path";
import type { StorageAdapter } from "../storage/types.ts";
import type { DuneConfig, SiteConfig } from "../config/types.ts";
import type {
  Page,
  PageIndex,
  MediaFile,
  RenderContext,
  TemplateComponent,
  TemplateProps,
} from "../content/types.ts";
import type { FormatRegistry } from "../content/formats/registry.ts";
import { buildIndex } from "../content/index-builder.ts";
import { loadPage as loadPageFromIndex } from "../content/page-loader.ts";
import { createRouteResolver } from "../routing/resolver.ts";
import type { RouteResolver, RouteMatch } from "../routing/resolver.ts";
import { createThemeLoader } from "../themes/loader.ts";
import type { ThemeLoader } from "../themes/loader.ts";

export interface DuneEngineOptions {
  /** Storage adapter (filesystem or KV) */
  storage: StorageAdapter;
  /** Full merged config */
  config: DuneConfig;
  /** Registered format handlers */
  formats: FormatRegistry;
  /** Base directory for themes (relative to project root) */
  themesDir?: string;
  /** Storage root directory (for resolving absolute paths) */
  storageRoot?: string;
}

export interface DuneEngine {
  /** The full merged config */
  config: DuneConfig;
  /** Site config shortcut */
  site: SiteConfig;
  /** The content index (lightweight PageIndex entries) */
  pages: PageIndex[];
  /** The taxonomy reverse map */
  taxonomyMap: Record<string, Record<string, string[]>>;
  /** Route resolver */
  router: RouteResolver;
  /** Theme loader */
  themes: ThemeLoader;

  /** Initialize the engine (build index, set up routing) */
  init(): Promise<void>;
  /** Resolve a URL pathname to a page (or redirect) */
  resolve(pathname: string): Promise<ResolveResult>;
  /** Load a full page from its source path */
  loadPage(sourcePath: string): Promise<Page>;
  /** Serve a media file — returns the file bytes and MIME type */
  serveMedia(mediaPath: string): Promise<MediaResponse | null>;
  /** Rebuild the content index (for dev mode / after changes) */
  rebuild(): Promise<void>;
}

export interface ResolveResult {
  type: "page" | "redirect" | "not-found";
  page?: Page;
  redirectTo?: string;
}

export interface MediaResponse {
  data: Uint8Array;
  contentType: string;
  size: number;
}

/**
 * Create and initialize a DuneEngine.
 */
export async function createDuneEngine(
  options: DuneEngineOptions,
): Promise<DuneEngine> {
  const { storage, config, formats } = options;
  const themesDir = options.themesDir ?? "themes";
  const contentDir = config.system.content.dir;
  const storageRoot = options.storageRoot;

  // State
  let pages: PageIndex[] = [];
  let taxonomyMap: Record<string, Record<string, string[]>> = {};
  let router: RouteResolver;
  let themes: ThemeLoader;

  // Page cache (sourcePath → Page)
  const pageCache = new Map<string, Page>();

  /**
   * Load a single page by source path (with caching).
   */
  async function loadPage(sourcePath: string): Promise<Page> {
    const cached = pageCache.get(sourcePath);
    if (cached) return cached;

    const page = await loadPageFromIndex(
      pages.find((p) => p.sourcePath === sourcePath)!,
      {
        storage,
        contentDir,
        formats,
        pages,
        loadPage,
        storageRoot,
      },
    );

    pageCache.set(sourcePath, page);
    return page;
  }

  /**
   * Initialize: build index, set up router & theme loader.
   */
  async function init(): Promise<void> {
    // Build content index
    const result = await buildIndex({ storage, contentDir, formats });
    pages = result.pages;
    taxonomyMap = result.taxonomyMap;

    if (config.system.debug) {
      console.log(
        `[dune] Indexed ${result.indexed} pages in ${result.duration}ms` +
        (result.errors.length > 0 ? ` (${result.errors.length} errors)` : ""),
      );
    }

    // Create route resolver
    router = createRouteResolver({
      pages,
      site: config.site,
    });

    // Create theme loader
    themes = await createThemeLoader({
      storage,
      themesDir,
      themeName: config.theme.name,
    });
  }

  /**
   * Resolve a URL pathname to a page or redirect.
   */
  async function resolve(pathname: string): Promise<ResolveResult> {
    const match = router.resolve(pathname);

    if (!match) {
      return { type: "not-found" };
    }

    if (match.type === "redirect") {
      return { type: "redirect", redirectTo: match.redirectTo };
    }

    if (match.page) {
      const page = await loadPage(match.page.sourcePath);
      return { type: "page", page };
    }

    return { type: "not-found" };
  }

  /**
   * Serve a co-located media file.
   * mediaPath is like "02.blog/01.hello-world/cover.jpg"
   */
  async function serveMedia(
    mediaPath: string,
  ): Promise<MediaResponse | null> {
    const fullPath = join(contentDir, mediaPath);

    try {
      if (!(await storage.exists(fullPath))) {
        return null;
      }

      const data = await storage.read(fullPath);
      const stat = await storage.stat(fullPath);
      const ext = fullPath.split(".").pop()?.toLowerCase() ?? "";

      const mimeTypes: Record<string, string> = {
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        png: "image/png",
        gif: "image/gif",
        webp: "image/webp",
        avif: "image/avif",
        svg: "image/svg+xml",
        mp4: "video/mp4",
        webm: "video/webm",
        mp3: "audio/mpeg",
        wav: "audio/wav",
        pdf: "application/pdf",
        json: "application/json",
        csv: "text/csv",
      };

      return {
        data,
        contentType: mimeTypes[ext] ?? "application/octet-stream",
        size: stat.size,
      };
    } catch {
      return null;
    }
  }

  /**
   * Rebuild content index and router (dev mode hot-reload).
   */
  async function rebuild(): Promise<void> {
    pageCache.clear();
    themes.clearCache();

    const result = await buildIndex({ storage, contentDir, formats });
    pages = result.pages;
    taxonomyMap = result.taxonomyMap;
    router.rebuild(pages);

    if (config.system.debug) {
      console.log(`[dune] Rebuilt index: ${result.indexed} pages in ${result.duration}ms`);
    }
  }

  // Build the engine object
  const engine: DuneEngine = {
    config,
    site: config.site,
    pages: [],
    taxonomyMap: {},
    router: undefined as unknown as RouteResolver,
    themes: undefined as unknown as ThemeLoader,

    async init() {
      await init();
      // Sync closure state to engine properties
      engine.pages = pages;
      engine.taxonomyMap = taxonomyMap;
      engine.router = router;
      engine.themes = themes;
    },

    resolve,
    loadPage,
    serveMedia,

    async rebuild() {
      await rebuild();
      // Sync closure state after rebuild
      engine.pages = pages;
      engine.taxonomyMap = taxonomyMap;
    },
  };

  return engine;
}
