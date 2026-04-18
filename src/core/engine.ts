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
import { parseFolderName } from "../content/path-utils.ts";
import { loadPage as loadPageFromIndex, getMimeType } from "../content/page-loader.ts";
import { loadBlueprints } from "../blueprints/loader.ts";
import type { BlueprintMap } from "../blueprints/types.ts";
import { createRouteResolver } from "../routing/resolver.ts";
import type { RouteResolver, RouteMatch } from "../routing/resolver.ts";
import { createThemeLoader } from "../themes/loader.ts";
import type { ThemeLoader } from "../themes/loader.ts";
import type { HookRegistry } from "../hooks/types.ts";
import { parse as parseYaml, stringify as stringifyYaml } from "@std/yaml";

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
  /**
   * Directory containing blueprint YAML files (default: "blueprints").
   * Blueprints define per-template frontmatter schemas.
   * Set to null to disable blueprint loading entirely.
   */
  blueprintsDir?: string | null;
  /**
   * Hook registry — when provided, the engine fires lifecycle events
   * (`onRebuild`, `onThemeSwitch`) so plugins can react to them.
   */
  hooks?: HookRegistry;
  /**
   * Absolute path to a shared themes directory (multi-site setups).
   * Passed through to the theme loader as a fallback when the active theme
   * is not found in the site's own `themes/` directory.
   */
  sharedThemesDir?: string;
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
  /** Loaded blueprint definitions (template name → definition) */
  blueprints: BlueprintMap;
  /** Route resolver */
  router: RouteResolver;
  /** Theme loader */
  themes: ThemeLoader;

  /**
   * User-controlled theme settings loaded from `data/theme-config.json`.
   * Empty object when no theme config file exists or the theme has no schema.
   */
  themeConfig: Record<string, unknown>;

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
  /**
   * List available theme names (subdirectory names under `themesDir`).
   * Used by the admin theme-switcher.
   */
  getAvailableThemes(): Promise<string[]>;
  /**
   * Switch the active theme, persist the change to `config/site.yaml`,
   * reload theme config, and rebuild the content index.
   *
   * Fires the `onThemeSwitch` hook if a hook registry was supplied.
   */
  switchTheme(name: string): Promise<void>;
  /**
   * Create a temporary theme loader for preview purposes.
   * Does NOT switch the active theme — the engine continues serving with the
   * current theme. Use the returned loader to render pages with an alternative
   * theme for display in the admin preview panel.
   */
  createPreviewTheme(name: string): Promise<ThemeLoader>;
  /**
   * Register additional template directories from plugins.
   * Must be called after plugin loading (bootstrap step 5a) so that plugin
   * templates are available before the first request is served.
   */
  setPluginTemplateDirs(dirs: string[]): void;
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
  const hooks = options.hooks;
  const themesDir = options.themesDir ?? "themes";
  const contentDir = config.system.content.dir;
  const storageRoot = options.storageRoot;
  const sharedThemesDir = options.sharedThemesDir;
  const blueprintsDir = options.blueprintsDir === null ? null : (options.blueprintsDir ?? "blueprints");
  const dataDir = config.admin?.dataDir ?? "data";
  const themeConfigPath = `${dataDir}/theme-config.json`;

  // State
  let pages: PageIndex[] = [];
  let taxonomyMap: Record<string, Record<string, string[]>> = {};
  let blueprints: BlueprintMap = {};
  let router: RouteResolver;
  let themes: ThemeLoader;
  let themeConfig: Record<string, unknown> = {};

  // Page cache (sourcePath → Page)
  const pageCache = new Map<string, Page>();

  /**
   * Load `data/theme-config.json` into the `themeConfig` closure variable.
   * Silently ignores missing or malformed files.
   */
  async function loadThemeConfig(): Promise<void> {
    try {
      const raw = await storage.readText(themeConfigPath);
      themeConfig = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      themeConfig = {};
    }
  }

  /**
   * List available theme names by scanning the themes directory.
   */
  async function getAvailableThemes(): Promise<string[]> {
    try {
      const entries = await storage.list(themesDir);
      return entries.filter((e) => !e.isFile).map((e) => e.name);
    } catch {
      return [];
    }
  }

  /**
   * Switch the active theme, persist to site.yaml, and rebuild.
   */
  async function switchTheme(name: string): Promise<void> {
    const oldName = config.theme.name;

    // Re-create the theme loader for the new theme
    themes = await createThemeLoader({
      storage,
      themesDir,
      themeName: name,
      rootDir: storageRoot,
      sharedThemesDir,
    });

    // Update in-memory config
    config.theme.name = name;

    // Persist to config/site.yaml (read → mutate → write)
    try {
      const existingRaw = await storage.readText("config/site.yaml").catch(() => "");
      const existing = ((parseYaml(existingRaw || "") ?? {}) as Record<string, unknown>);
      const themeKey = existing.theme as Record<string, unknown> | undefined;
      existing.theme = { ...(themeKey ?? {}), name };
      await storage.write(
        "config/site.yaml",
        new TextEncoder().encode(stringifyYaml(existing).trimEnd() + "\n"),
      );
    } catch (err) {
      console.warn("[dune] switchTheme: could not persist to site.yaml:", err);
    }

    // Reload theme config for the new theme
    await loadThemeConfig();

    // Fire hook so plugins can react
    if (hooks) {
      await hooks.fire("onThemeSwitch", { from: oldName, to: name });
    }

    // Rebuild content index
    await rebuild();
  }

  // Rebuild guard — prevents concurrent rebuilds from interleaving their
  // mutations to pages/taxonomyMap/router, which would expose partial state.
  // In dev mode, rapid file changes can trigger multiple rebuild() calls;
  // we serialize them by chaining onto the in-flight rebuild promise.
  let rebuildChain: Promise<void> = Promise.resolve();

  /**
   * Load a single page by source path (with caching).
   */
  async function loadPage(sourcePath: string): Promise<Page> {
    const cached = pageCache.get(sourcePath);
    if (cached) return cached;

    const indexEntry = pages.find((p) => p.sourcePath === sourcePath);
    if (!indexEntry) {
      throw new Error(
        `[dune] loadPage: "${sourcePath}" not found in content index. ` +
        `This usually means the page was deleted or the index is stale — call rebuild() first.`,
      );
    }

    const page = await loadPageFromIndex(
      indexEntry,
      {
        storage,
        contentDir,
        formats,
        pages,
        loadPage,
        storageRoot,
        orphanProtection: config.system.typography?.orphan_protection !== false,
        site: config.site,
      },
    );

    pageCache.set(sourcePath, page);
    return page;
  }

  /**
   * Initialize: build index, set up router & theme loader.
   */
  async function init(): Promise<void> {
    // Load blueprints (best-effort — missing blueprints dir is not an error)
    if (blueprintsDir !== null) {
      blueprints = await loadBlueprints(storage, blueprintsDir);
      if (config.system.debug && Object.keys(blueprints).length > 0) {
        console.log(`[dune] Loaded ${Object.keys(blueprints).length} blueprint(s): ${Object.keys(blueprints).join(", ")}`);
      }
    }

    // Build content index
    const result = await buildIndex({
      storage,
      contentDir,
      formats,
      siteHome: config.site.home,
      supportedLanguages: config.system.languages?.supported,
      defaultLanguage: config.system.languages?.default,
      blueprints,
    });
    pages = result.pages;
    taxonomyMap = result.taxonomyMap;

    if (config.system.debug) {
      console.log(
        `[dune] Indexed ${result.indexed} pages in ${result.duration}ms` +
        ` (home: ${result.homeSlug})` +
        (result.errors.length > 0 ? ` (${result.errors.length} errors)` : ""),
      );
    }

    // Create route resolver
    router = createRouteResolver({
      pages,
      site: config.site,
      homeSlug: result.homeSlug,
      supportedLanguages: config.system.languages?.supported,
      defaultLanguage: config.system.languages?.default,
      includeDefaultInUrl: config.system.languages?.include_default_in_url,
    });

    // Load theme user config (best-effort)
    await loadThemeConfig();

    // Create theme loader
    themes = await createThemeLoader({
      storage,
      themesDir,
      themeName: config.theme.name,
      rootDir: storageRoot,
      sharedThemesDir,
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
      // File-type pages redirect directly to their co-located file —
      // templates don't need to handle this case.
      if (match.page.fileUrl) {
        return { type: "redirect", redirectTo: match.page.fileUrl };
      }
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
    // url.pathname preserves percent-encoding; decode before filesystem lookup
    // so filenames with spaces or non-ASCII characters are found correctly.
    let decoded: string;
    try {
      decoded = decodeURIComponent(mediaPath);
    } catch {
      return null; // malformed percent-encoding
    }

    // Resolve the media path to an actual filesystem path.
    // Directory segments may be either:
    //   - literal prefixed names ("04.einstieg") — backward compat
    //   - clean slugs ("einstieg") — canonical going forward
    // The filename (last segment) is always matched literally.
    const resolved = await resolveMediaPath(decoded);
    if (!resolved) return null;

    try {
      const data = await storage.read(resolved);
      const stat = await storage.stat(resolved);
      return {
        data,
        contentType: getMimeType(resolved),
        size: stat.size,
      };
    } catch {
      return null;
    }
  }

  /**
   * Resolve a media path to an absolute filesystem path, accepting both
   * numeric-prefixed directory names ("04.einstieg") and clean slugs
   * ("einstieg"). The filename segment is matched literally. Returns null
   * if the file cannot be located.
   */
  async function resolveMediaPath(decoded: string): Promise<string | null> {
    // Guard against path traversal before any resolution.
    const naive = join(contentDir, decoded);
    if (!naive.startsWith(contentDir + "/") && naive !== contentDir) {
      return null;
    }

    const segments = decoded.split("/").filter(Boolean);
    let current = contentDir;

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const isLast = i === segments.length - 1;
      const candidate = join(current, segment);

      // Fast path: exact match (handles prefixed paths and plain filenames).
      if (await storage.exists(candidate)) {
        current = candidate;
        continue;
      }

      // For directory segments only: scan for a numeric-prefixed entry whose
      // slug matches the clean segment name ("einstieg" → "04.einstieg").
      if (!isLast) {
        try {
          const entries = await storage.list(current);
          const match = entries.find(
            (e) => e.isDirectory && parseFolderName(e.name).slug === segment,
          );
          if (match) {
            current = join(current, match.name);
            continue;
          }
        } catch {
          // current directory doesn't exist or isn't listable
        }
      }

      return null; // segment not found
    }

    return current === contentDir ? null : current;
  }

  /**
   * Rebuild content index and router (dev mode hot-reload).
   *
   * Serialized via rebuildChain — concurrent calls queue behind the in-flight
   * rebuild rather than interleaving their mutations to shared state.
   */
  function rebuild(): Promise<void> {
    rebuildChain = rebuildChain.then(async () => {
      pageCache.clear();
      themes.clearCache();

      // Reload blueprints in case any changed on disk
      if (blueprintsDir !== null) {
        blueprints = await loadBlueprints(storage, blueprintsDir);
      }

      const result = await buildIndex({
        storage,
        contentDir,
        formats,
        siteHome: config.site.home,
        supportedLanguages: config.system.languages?.supported,
        defaultLanguage: config.system.languages?.default,
        blueprints,
      });
      pages = result.pages;
      taxonomyMap = result.taxonomyMap;
      router.rebuild(pages, result.homeSlug);

      if (config.system.debug) {
        console.log(`[dune] Rebuilt index: ${result.indexed} pages in ${result.duration}ms`);
      }

      if (hooks) {
        await hooks.fire("onRebuild", {});
      }
    });
    return rebuildChain;
  }

  // Build the engine object
  const engine: DuneEngine = {
    config,
    site: config.site,
    pages: [],
    taxonomyMap: {},
    blueprints: {},
    themeConfig: {},
    router: undefined as unknown as RouteResolver,
    themes: undefined as unknown as ThemeLoader,

    async init() {
      await init();
      // Sync closure state to engine properties
      engine.pages = pages;
      engine.taxonomyMap = taxonomyMap;
      engine.blueprints = blueprints ?? {};
      engine.router = router;
      engine.themes = themes;
      engine.themeConfig = themeConfig;
    },

    resolve,
    loadPage,
    serveMedia,

    async rebuild() {
      await rebuild();
      // Sync closure state after rebuild
      engine.pages = pages;
      engine.taxonomyMap = taxonomyMap;
      engine.blueprints = blueprints ?? {};
    },

    getAvailableThemes,

    async switchTheme(name: string) {
      await switchTheme(name);
      engine.themes = themes;
      engine.themeConfig = themeConfig;
    },

    createPreviewTheme(name: string) {
      return createThemeLoader({ storage, themesDir, themeName: name, rootDir: storageRoot, sharedThemesDir });
    },

    setPluginTemplateDirs(dirs: string[]) {
      themes.addTemplateDirs(dirs);
    },
  };

  return engine;
}
