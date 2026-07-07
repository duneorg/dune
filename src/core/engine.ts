/**
 * DuneEngine — orchestrates the entire CMS.
 *
 * Wires together: storage, config, content index, page loader,
 * route resolver, theme loader.
 *
 * This is the single entry point that Fresh routes use to
 * resolve URLs, load pages, and render content.
 *
 * @module
 */

import { join } from "@std/path";
import { logger } from "./logger.ts";
import { tracer } from "../tracing/mod.ts";
import type { StorageAdapter } from "../storage/types.ts";
import type { DuneConfig, SiteConfig } from "../config/types.ts";
import type {
  Page,
  PageIndex,
} from "../content/types.ts";
import type { FormatRegistry } from "../content/formats/registry.ts";
import { buildIndex } from "../content/index-builder.ts";
import { createContentStorage, resolveContentDirPath } from "../content/content-root.ts";
import { parseFolderName } from "../content/path-utils.ts";
import { loadPage as loadPageFromIndex, getMimeType } from "../content/page-loader.ts";
import { IFRAME_SENDER_SCRIPT } from "../content/formats/media-resolve.ts";
import { loadBlueprints } from "../blueprints/loader.ts";
import type { BlueprintMap } from "../blueprints/types.ts";
import { createRouteResolver } from "../routing/resolver.ts";
import type { RouteResolver } from "../routing/resolver.ts";
import { createThemeLoader } from "../themes/loader.ts";
import type { ThemeLoader } from "../themes/loader.ts";
import {
  buildThemePackageIndex,
  buildThemePackageStaticDirs,
  type ThemePackageIndex,
} from "../themes/packages.ts";
import type { HookRegistry } from "../hooks/types.ts";
import { parse as parseYaml, stringify as stringifyYaml } from "@std/yaml";

/** Options for {@link createDuneEngine}. */
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

/**
 * The Dune CMS engine — the central object that wires together storage,
 * content index, routing, and theme loading.
 *
 * Obtain via {@link createDuneEngine}.
 */
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
  /** Storage adapter for reading and writing site files */
  storage: StorageAdapter;
  /**
   * Storage adapter for content, and the contentDir to use with it.
   * Equal to `{storage, contentDir: config.system.content.dir}` unless
   * `content.src` is set, in which case this is a separate storage instance
   * rooted at the resolved external path (contentDir is then `"."`).
   * External consumers that read/write content (admin services, SSG,
   * multisite) should use this pair rather than `storage` + the raw
   * `config.system.content.dir`.
   */
  contentStorage: StorageAdapter;
  contentDir: string;
  /** Route resolver */
  router: RouteResolver;
  /** Theme loader */
  themes: ThemeLoader;

  /**
   * Package-backed themes: logical name → absolute `static/` directory.
   * Used when serving `/themes/{name}/static/*` for JSR/npm themes.
   */
  themePackageStaticDirs: ReadonlyMap<string, string>;

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

/** Return type of {@link DuneEngine.resolve} — a resolved page, redirect, or 404. */
export interface ResolveResult {
  type: "page" | "redirect" | "not-found";
  page?: Page;
  redirectTo?: string;
}

/** Byte payload returned by {@link DuneEngine.serveMedia}. */
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
  const storageRoot = options.storageRoot;
  const { storage: contentStorage, contentDir } = createContentStorage(
    config.system.content,
    storageRoot ?? Deno.cwd(),
    storage,
  );
  // TSX dynamic imports resolve contentFilePath (already contentDir-relative)
  // against this root. When content.src is unset, contentFilePath still
  // carries the "{dir}/" prefix, so the site's own storageRoot is correct
  // (unchanged behavior). When content.src is set, contentDir is "." and
  // contentFilePath has no prefix — so the import root must be the resolved
  // external content path instead.
  const contentStorageRoot = config.system.content.src
    ? resolveContentDirPath(config.system.content, storageRoot ?? Deno.cwd())
    : storageRoot;
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
  let themePackageIndex: ThemePackageIndex = { byName: new Map(), bySrc: new Map() };
  let themePackageStaticDirs: ReadonlyMap<string, string> = new Map();

  async function refreshThemePackages(): Promise<void> {
    const siteRoot = storageRoot ?? Deno.cwd();
    themePackageIndex = await buildThemePackageIndex({
      siteRoot,
      packages: config.themeList ?? [],
      active: config.theme.src
        ? { name: config.theme.name, src: config.theme.src }
        : undefined,
    });
    themePackageStaticDirs = buildThemePackageStaticDirs(themePackageIndex);
  }

  function themeLoaderOptions(name: string, theme = config.theme) {
    return {
      storage,
      themesDir,
      themeName: name,
      rootDir: storageRoot,
      siteRoot: storageRoot,
      sharedThemesDir,
      packages: themePackageIndex,
      activeSrc: theme.src,
      parentOverride: theme.parent,
    };
  }

  // Page cache (sourcePath → Page)
  const pageCache = new Map<string, Page>();

  /**
   * Load `data/theme-config.json` into the `themeConfig` closure variable.
   * The file is namespaced by theme name (`{"caravan": {...}, "blox": {...}}`)
   * so that switching themes doesn't discard another theme's saved settings.
   * Silently ignores missing or malformed files.
   */
  async function loadThemeConfig(): Promise<void> {
    try {
      const raw = await storage.readText(themeConfigPath);
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const forTheme = parsed[config.theme.name];
      themeConfig = (forTheme && typeof forTheme === "object" && !Array.isArray(forTheme))
        ? forTheme as Record<string, unknown>
        : {};
    } catch {
      themeConfig = {};
    }
  }

  /**
   * Discover the template names available in the active theme's templates/
   * directory. Used by the content indexer so that content files whose stem
   * matches a template name are treated as template selectors rather than
   * flat content files (Grav-style page folders).
   */
  async function discoverThemeTemplateNames(): Promise<Set<string>> {
    const names = new Set<string>();
    const themeTemplatesDir = `${themesDir}/${config.theme.name}/templates`;
    try {
      const entries = await storage.list(themeTemplatesDir);
      for (const entry of entries) {
        if (entry.isFile && entry.name.endsWith(".tsx")) {
          names.add(entry.name.slice(0, -".tsx".length));
        }
      }
    } catch {
      // No local templates directory
    }
    const pkgRoot = themePackageIndex.byName.get(config.theme.name);
    if (pkgRoot) {
      try {
        for await (const entry of Deno.readDir(join(pkgRoot, "templates"))) {
          if (entry.isFile && entry.name.endsWith(".tsx")) {
            names.add(entry.name.slice(0, -".tsx".length));
          }
        }
      } catch {
        // No templates in package
      }
    }
    return names;
  }

  /**
   * List available theme names by scanning the themes directory.
   */
  async function getAvailableThemes(): Promise<string[]> {
    const names = new Set<string>();
    for (const entry of config.themeList ?? []) {
      names.add(entry.name);
    }
    try {
      const entries = await storage.list(themesDir);
      for (const e of entries) {
        if (!e.isFile) names.add(e.name);
      }
    } catch {
      // No themes directory
    }
    return [...names].sort();
  }

  /**
   * Switch the active theme, persist to site.yaml, and rebuild.
   */
  async function switchTheme(name: string): Promise<void> {
    const oldName = config.theme.name;

    // Re-create the theme loader for the new theme
    themes = await createThemeLoader(themeLoaderOptions(name));

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
      logger.warn("theme.switch.persist-failed", { error: String(err) });
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
        storage: contentStorage,
        contentDir,
        formats,
        pages,
        loadPage,
        storageRoot: contentStorageRoot,
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
    await refreshThemePackages();

    // Load blueprints (best-effort — missing blueprints dir is not an error)
    if (blueprintsDir !== null) {
      blueprints = await loadBlueprints(storage, blueprintsDir);
      if (config.system.debug && Object.keys(blueprints).length > 0) {
        logger.debug("blueprints.loaded", {
          count: Object.keys(blueprints).length,
          names: Object.keys(blueprints).join(", "),
        });
      }
    }

    // Build content index
    const result = await buildIndex({
      storage: contentStorage,
      contentDir,
      formats,
      siteHome: config.site.home,
      supportedLanguages: config.system.languages?.supported,
      defaultLanguage: config.system.languages?.default,
      blueprints,
      facetFields: config.system.search?.facets?.map((f) => f.field),
      templateNames: await discoverThemeTemplateNames(),
    });
    pages = result.pages;
    taxonomyMap = result.taxonomyMap;

    if (config.system.debug) {
      logger.debug("index.built", {
        indexed: result.indexed,
        durationMs: result.duration,
        home: result.homeSlug,
        errors: result.errors.length,
      });
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

    // Create theme loader (packages already resolved above)
    themes = await createThemeLoader(themeLoaderOptions(config.theme.name));
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
      let data = await contentStorage.read(resolved);
      const contentType = getMimeType(resolved);

      // Inject the iframe height-sender script into co-located HTML files.
      // This pairs with the listener emitted by resolveMediaRefs() Pass 5 so
      // that <iframe src="./file.html"> embeds auto-size to their content
      // without any author configuration.
      if (contentType === "text/html") {
        const html = new TextDecoder().decode(data);
        const injected = html.includes("</body>")
          ? html.replace("</body>", `${IFRAME_SENDER_SCRIPT}</body>`)
          : html + IFRAME_SENDER_SCRIPT;
        data = new TextEncoder().encode(injected);
      }

      return {
        data,
        contentType,
        size: data.byteLength,
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
    // When contentDir is "." (content.src set — the site's storage root IS
    // the content root), `join(".", x)` normalizes away the "./" prefix, so
    // the `contentDir + "/"` prefix check below never matches even for
    // legitimate paths. Check for upward escape directly in that case; the
    // contentStorage adapter's own containment guard is the backstop either way.
    const naive = join(contentDir, decoded);
    const withinContentDir = contentDir === "."
      ? naive === "." || (!naive.startsWith("../") && naive !== "..")
      : naive === contentDir || naive.startsWith(contentDir + "/");
    if (!withinContentDir) {
      return null;
    }

    const segments = decoded.split("/").filter(Boolean);
    let current = contentDir;

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const isLast = i === segments.length - 1;
      const candidate = join(current, segment);

      // Fast path: exact match (handles prefixed paths and plain filenames).
      if (await contentStorage.exists(candidate)) {
        current = candidate;
        continue;
      }

      // For directory segments only: scan for a numeric-prefixed entry whose
      // slug matches the clean segment name ("einstieg" → "04.einstieg").
      if (!isLast) {
        try {
          const entries = await contentStorage.list(current);
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
      await tracer.startActiveSpan("engine.rebuild", { pageCount: pages.length }, async (span) => {
        pageCache.clear();
        themes.clearCache();

        // Reload blueprints in case any changed on disk
        if (blueprintsDir !== null) {
          blueprints = await loadBlueprints(storage, blueprintsDir);
        }

        const result = await buildIndex({
          storage: contentStorage,
          contentDir,
          formats,
          siteHome: config.site.home,
          supportedLanguages: config.system.languages?.supported,
          defaultLanguage: config.system.languages?.default,
          blueprints,
          facetFields: config.system.search?.facets?.map((f) => f.field),
          templateNames: await discoverThemeTemplateNames(),
        });
        pages = result.pages;
        taxonomyMap = result.taxonomyMap;
        router.rebuild(pages, result.homeSlug);

        span.setAttribute("pageCount", pages.length);

        if (config.system.debug) {
          logger.debug("index.rebuilt", { indexed: result.indexed, durationMs: result.duration });
        }

        if (hooks) {
          await hooks.fire("onRebuild", {});
        }
      });
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
    storage,
    contentStorage,
    contentDir,
    themeConfig: {},
    themePackageStaticDirs: new Map<string, string>(),
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
      engine.themePackageStaticDirs = themePackageStaticDirs;
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
      return createThemeLoader(themeLoaderOptions(name));
    },

    setPluginTemplateDirs(dirs: string[]) {
      themes.addTemplateDirs(dirs);
    },
  };

  return engine;
}
