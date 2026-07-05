/**
 * Theme loader — discovers themes, resolves inheritance chains,
 * and loads template components.
 *
 * Theme resolution (per PRD §9.2):
 *   1. Look in child theme templates/
 *   2. Look in parent theme templates/
 *   3. Error if not found
 *
 * Template resolution for .md pages (per PRD §7.3):
 *   1. Frontmatter `template` field → templates/{template}.tsx
 *   2. Content filename convention → post.md → templates/post.tsx
 *   3. Fallback → templates/default.tsx
 *
 * For .tsx pages: the component IS the template, but layout wrapping
 * is resolved from the theme's components/ directory.
 *
 * Hot-reload strategy:
 *   Deno caches `import()` by URL. Appending `?v=N` busts the cache
 *   for the directly imported module. Since theme templates receive all
 *   data as props (no imports from CMS internals), this simple approach
 *   is sufficient — layout/component imports are sibling-relative and
 *   get their own `?v=N` when loaded via loadLayout().
 */

import { join, dirname, resolve } from "@std/path";
import type { StorageAdapter } from "../storage/types.ts";
import type { TemplateComponent, Page, PageIndex } from "../content/types.ts";
import type { ThemeManifest, ResolvedTheme, LoadedTemplate } from "./types.ts";
import type { ThemePackageIndex } from "./packages.ts";
import {
  defaultThemeNameFromSpecifier,
  isLocalThemePath,
  isRemoteThemeSpecifier,
  normalizeThemeSpecifier,
  resolveThemePackageRoot,
  resolveThemeSpecifier,
} from "./reference.ts";

/**
 * Collect absolute paths to all island files across the active theme chain.
 *
 * For each theme in the chain (child → parent → grandparent), enumerates all
 * `.tsx` files in `themes/{name}/islands/`. Returns a deduplicated list of
 * absolute paths registered with Fresh's builder as island specifiers.
 *
 * Theme authors drop `.tsx` Preact components into `themes/{name}/islands/`,
 * import them from templates using a relative path (`../islands/MyIsland.tsx`),
 * and Fresh handles bundling and browser hydration automatically. No
 * `theme.yaml` declaration needed — the directory is the registration.
 *
 * Called at startup by both `dune dev` and `dune serve`. In dev mode, Fresh
 * also watches the islands directory directly and rebuilds the JS bundle when
 * any island file changes.
 */
export async function collectThemeIslands(
  theme: ResolvedTheme,
): Promise<string[]> {
  const seen = new Set<string>();
  const islands: string[] = [];

  let current: ResolvedTheme | undefined = theme;
  while (current) {
    const islandsDir = join(current.absoluteRoot, "islands");
    try {
      for await (const entry of Deno.readDir(islandsDir)) {
        if (!entry.isFile || !entry.name.endsWith(".tsx")) continue;
        const absPath = join(islandsDir, entry.name);
        if (!seen.has(absPath)) {
          seen.add(absPath);
          islands.push(absPath);
        }
      }
    } catch {
      // No islands/ directory in this theme — that's fine
    }
    current = current.parent;
  }

  return islands;
}

/**
 * Collect absolute paths to island files imported by TSX content pages.
 *
 * Scans all pages with `format === "tsx"`, reads each source file, and
 * extracts relative imports that resolve to `.tsx` files inside any
 * `islands/` directory (co-located, theme-relative, or plugin). Returns
 * deduplicated absolute paths suitable for use as Builder `islandSpecifiers`.
 *
 * This is the auto-discovery mechanism for TSX content pages: authors drop
 * islands next to their content file (or import from the theme's islands/),
 * and they are bundled automatically — no explicit registration needed.
 *
 * @param pages - All indexed content pages (e.g. engine.pages — PageIndex[])
 * @param contentRoot - Absolute path to the content root (resolve via
 *   `resolveContentDirPath()` — accounts for `content.src` when set)
 */
export async function collectContentIslands(
  pages: PageIndex[],
  contentRoot: string,
): Promise<string[]> {
  const seen = new Set<string>();
  const islands: string[] = [];

  // Match `from "..."` or `from '...'` — works for both single-line and
  // multi-line import statements. We check the path rather than the full
  // import statement, so type-only imports are harmless (they produce no JS).
  const importRe = /\bfrom\s+["']([^"']+)["']/g;

  for (const page of pages) {
    if (page.format !== "tsx") continue;

    const absPagePath = join(contentRoot, page.sourcePath);
    let source: string;
    try {
      source = await Deno.readTextFile(absPagePath);
    } catch {
      continue; // File not readable (stale index?) — skip gracefully
    }

    const pageDir = dirname(absPagePath);
    importRe.lastIndex = 0; // Reset stateful regex between pages

    let match: RegExpExecArray | null;
    while ((match = importRe.exec(source)) !== null) {
      const importPath = match[1];

      // Only follow relative imports; bare specifiers are never island files
      if (!importPath.startsWith(".")) continue;

      // Resolve the import path relative to the page's directory
      const resolved = resolve(pageDir, importPath);

      // Determine the actual .tsx file path
      let filePath: string | null = null;
      if (resolved.endsWith(".tsx")) {
        filePath = resolved;
      } else {
        // Try appending .tsx extension (import without explicit extension)
        const candidate = resolved + ".tsx";
        try {
          await Deno.stat(candidate);
          filePath = candidate;
        } catch {
          continue; // Not a .tsx file — skip
        }
      }

      // Only collect files inside an islands/ directory
      if (!filePath.includes("/islands/")) continue;

      if (!seen.has(filePath)) {
        seen.add(filePath);
        islands.push(filePath);
      }
    }
  }

  return islands;
}

/** Options for {@link createThemeLoader}. */
export interface ThemeLoaderOptions {
  storage: StorageAdapter;
  /** Base directory where themes live (e.g., "themes") */
  themesDir: string;
  /** Active theme name from config */
  themeName: string;
  /** Root directory for resolving absolute paths (optional, defaults to cwd) */
  rootDir?: string;
  /**
   * Additional template directories (e.g. from plugins) searched after the
   * full theme inheritance chain. Absolute paths to directories containing
   * .tsx template files.
   */
  extraTemplateDirs?: string[];
  /**
   * Absolute path to a shared themes directory (multi-site setups).
   * When the active theme is not found in the site's own `themesDir`, the
   * loader checks here before throwing. All file operations for a shared
   * theme use an independent storage adapter rooted at this directory.
   *
   * Note: a site-local child theme that inherits from a shared parent theme
   * is not supported — both themes in an inheritance chain must reside in
   * the same location (site-local or shared).
   */
  sharedThemesDir?: string;
  /** Absolute site root — required for package theme resolution. */
  siteRoot?: string;
  /** Resolved JSR/npm theme packages from site config. */
  packages?: ThemePackageIndex;
  /** When the active theme is package-backed (`theme.src`). */
  activeSrc?: string;
  /**
   * site.yaml `theme.parent` — overrides manifest `parent` on the active theme only.
   */
  parentOverride?: string;
}

/** Loads and resolves theme templates, layouts, and locales. Obtain via {@link createThemeLoader}. */
export interface ThemeLoader {
  theme: ResolvedTheme;
  /**
   * The root directory relative to which `ResolvedTheme.dir` is resolved.
   * For site-local themes this is the site root; for shared themes it is
   * the shared themes directory. Useful when calling `collectThemeIslands`.
   */
  rootDir: string;
  resolveTemplateName(page: Page): string | null;
  loadTemplate(name: string): Promise<LoadedTemplate | null>;
  loadLayout(name: string): Promise<TemplateComponent | null>;
  loadLocale(lang: string): Promise<Record<string, string>>;
  getAvailableTemplates(): string[];
  clearCache(): void;
  addTemplateDirs(dirs: string[]): void;
}

/**
 * Create a theme loader that discovers and loads theme templates.
 */
export async function createThemeLoader(options: ThemeLoaderOptions): Promise<ThemeLoader> {
  let { storage, themesDir, themeName, rootDir } = options;
  const { sharedThemesDir, siteRoot, packages, activeSrc, parentOverride } = options;
  const effectiveSiteRoot = siteRoot ?? rootDir ?? Deno.cwd();

  // When the theme doesn't exist in the site's own themes/ directory,
  // fall back to the shared themes directory (multi-site setups only).
  if (sharedThemesDir) {
    const localThemeDir = join(themesDir, themeName);
    const localExists = await storage.exists(localThemeDir);
    const packageBacked = Boolean(activeSrc || packages?.byName.has(themeName));
    if (!localExists && !packageBacked) {
      const { createStorage } = await import("../storage/mod.ts");
      const sharedStorage = createStorage({ rootDir: sharedThemesDir });
      if (await sharedStorage.exists(themeName)) {
        storage = sharedStorage;
        themesDir = "";
        rootDir = sharedThemesDir;
      }
    }
  }

  const resolveCtx: ThemeResolveContext = {
    siteStorage: storage,
    siteRoot: rootDir ?? effectiveSiteRoot,
    themesDir,
    packages: packages ?? { byName: new Map(), bySrc: new Map() },
  };

  // Resolve the theme chain (child → parent → grandparent...)
  const theme = await resolveThemeChain(
    themeName,
    resolveCtx,
    new Set(),
    parentOverride,
    activeSrc,
  );

  // Mutable list of extra template dirs (populated after plugin loading).
  const extraTemplateDirs: string[] = [...(options.extraTemplateDirs ?? [])];

  // Template component cache (lazy-loaded on first use)
  // Each entry stores the component, the mtime at load time, and the
  // timestamp of the last mtime check so we can throttle Deno.stat calls.
  interface CacheEntry {
    component: TemplateComponent;
    mtime: number;
    absPath: string;
    /** Timestamp (ms) of the last mtime stat — used to throttle Deno.stat. */
    lastChecked: number;
  }
  const templateCache = new Map<string, CacheEntry>();
  const layoutCache = new Map<string, CacheEntry>();
  const localeCache = new Map<string, Record<string, string>>();

  /**
   * Minimum interval between mtime stat calls per cached file.
   * Avoids a Deno.stat syscall on every single request while still
   * detecting file changes within a few seconds.
   */
  const MTIME_CHECK_TTL_MS = 5_000;

  // Per-file import version counters — incremented when a file's mtime changes.
  const importVersions = new Map<string, number>();

  /**
   * Get the current mtime for an absolute file path. Returns 0 on error.
   */
  async function getMtime(absPath: string): Promise<number> {
    try {
      const stat = await Deno.stat(absPath);
      return stat.mtime?.getTime() ?? 0;
    } catch {
      return 0;
    }
  }

  /**
   * Get the import URL for a theme file.
   * Uses a per-file version counter so only changed files get re-imported,
   * not the entire cache.
   */
  function getImportUrl(absPath: string): string {
    const v = importVersions.get(absPath) ?? 0;
    const base = `file://${absPath}`;
    return v === 0 ? base : `${base}?v=${v}`;
  }

  /**
   * Bump the per-file import version for a given path.
   */
  function bumpVersion(absPath: string): void {
    importVersions.set(absPath, (importVersions.get(absPath) ?? 0) + 1);
  }

  const loader: ThemeLoader = {
    /** The resolved theme with inheritance chain */
    theme,
    /** Effective root directory for this theme chain */
    rootDir: rootDir ?? Deno.cwd(),

    /**
     * Resolve a template name for a page.
     *
     * For .md pages:
     *   1. frontmatter.template field
     *   2. content filename (post.md → "post")
     *   3. fallback to "default"
     *
     * For .tsx pages: returns null (component renders itself)
     */
    resolveTemplateName(page: Page): string | null {
      if (page.format === "tsx") return null;

      // 1. Explicit template in frontmatter
      if (page.frontmatter.template) {
        return page.frontmatter.template;
      }

      // 2. Content filename convention
      // page.template is already derived from the filename during indexing
      if (page.template && page.template !== "self") {
        return page.template;
      }

      // 3. Default fallback
      return "default";
    },

    /**
     * Load a template component by name.
     * Follows the theme inheritance chain.
     */
    async loadTemplate(name: string): Promise<LoadedTemplate | null> {
      // Reject traversal or unusual names. `name` comes from page
      // frontmatter (admin/editor-authored) — defense-in-depth against
      // a compromised author account planting `../../etc/passwd`.
      if (!/^[a-zA-Z0-9_-]+$/.test(name)) return null;

      // Check cache — but validate mtime so file changes are picked up
      // without needing a restart (works in both dev and production).
      // Mtime checks are throttled by MTIME_CHECK_TTL_MS to avoid a
      // Deno.stat syscall on every request.
      const cached = templateCache.get(name);
      if (cached) {
        const now = Date.now();
        if (now - cached.lastChecked < MTIME_CHECK_TTL_MS) {
          return { name, component: cached.component, fromTheme: theme.manifest.name };
        }
        const currentMtime = await getMtime(cached.absPath);
        if (currentMtime === cached.mtime) {
          cached.lastChecked = now;
          return { name, component: cached.component, fromTheme: theme.manifest.name };
        }
        // File changed — invalidate this entry and re-import with a bumped version
        templateCache.delete(name);
        bumpVersion(cached.absPath);
      }

      let current: ResolvedTheme | undefined = theme;
      while (current) {
        const active: ResolvedTheme = current;
        const absPath = join(active.absoluteRoot, "templates", `${name}.tsx`);
        try {
          const stat = await Deno.stat(absPath);
          if (!stat.isFile) {
            current = active.parent;
            continue;
          }
          const mtime = await getMtime(absPath);
          const fileUrl = getImportUrl(absPath);
          const mod = await import(fileUrl); // lockfile-safe: theme template (file:// URL)
          if (!mod.default) {
            current = active.parent;
            continue;
          }
          const component = mod.default as TemplateComponent;
          const templatePath = join(active.dir, "templates", `${name}.tsx`);
          warnStaticLayoutImport(templatePath, active.storage);
          templateCache.set(name, { component, mtime, absPath, lastChecked: Date.now() });
          return { name, component, fromTheme: active.manifest.name };
        } catch (err) {
          console.warn(`  ⚠️  Failed to load template ${absPath}: ${err}`);
        }
        current = active.parent;
      }

      // Fallback: check plugin template directories (lowest priority)
      for (const dir of extraTemplateDirs) {
        const templatePath = join(dir, `${name}.tsx`);
        try {
          const stat = await Deno.stat(templatePath);
          if (stat.isFile) {
            const absPath = templatePath;
            const mtime = stat.mtime?.getTime() ?? 0;
            const fileUrl = getImportUrl(absPath);
            const mod = await import(fileUrl); // lockfile-safe: site-local (theme/plugin template file, resolved to file:// URL)
            if (!mod.default) continue;
            const component = mod.default as TemplateComponent;
            templateCache.set(name, { component, mtime, absPath, lastChecked: Date.now() });
            return { name, component, fromTheme: "(plugin)" };
          }
        } catch {
          // Not in this plugin dir — continue
        }
      }

      return null;
    },

    /**
     * Load a layout component by name.
     * Used for wrapping .tsx content pages.
     */
    async loadLayout(name: string): Promise<TemplateComponent | null> {
      // Check cache — validate mtime so layout changes are picked up automatically.
      // Throttled by MTIME_CHECK_TTL_MS to avoid per-request Deno.stat calls.
      const cached = layoutCache.get(name);
      if (cached) {
        const now = Date.now();
        if (now - cached.lastChecked < MTIME_CHECK_TTL_MS) return cached.component;
        const currentMtime = await getMtime(cached.absPath);
        if (currentMtime === cached.mtime) {
          cached.lastChecked = now;
          return cached.component;
        }
        layoutCache.delete(name);
        bumpVersion(cached.absPath);
      }

      let current: ResolvedTheme | undefined = theme;
      while (current) {
        const active: ResolvedTheme = current;
        const absPath = join(active.absoluteRoot, "components", `${name}.tsx`);
        try {
          const stat = await Deno.stat(absPath);
          if (!stat.isFile) {
            current = active.parent;
            continue;
          }
          const mtime = await getMtime(absPath);
          const fileUrl = getImportUrl(absPath);
          const mod = await import(fileUrl); // lockfile-safe: theme layout (file:// URL)
          const component = mod.default as TemplateComponent;
          if (component) {
            layoutCache.set(name, { component, mtime, absPath, lastChecked: Date.now() });
            return component;
          }
        } catch {
          // Continue to parent
        }
        current = active.parent;
      }

      return null;
    },

    /**
     * Load theme UI locale strings for a language.
     * Merges themes/{theme}/locales/{lang}.json per key across the whole
     * theme chain: parent-most first, child-most last, so a child theme can
     * override individual keys without copying the parent's locale file.
     * The chain-merged "en" locale is layered underneath as fallback when
     * lang != "en". Returns a flat object of key → string for use with t(key).
     */
    async loadLocale(lang: string): Promise<Record<string, string>> {
      const cached = localeCache.get(lang);
      if (cached) return cached;

      const fallback = lang !== "en" ? await loader.loadLocale("en") : null;

      // Collect the chain child-most → parent-most, then merge in reverse
      // so child keys win over parent keys.
      const chain: ResolvedTheme[] = [];
      let current: ResolvedTheme | undefined = theme;
      while (current) {
        chain.push(current);
        current = current.parent;
      }

      const merged: Record<string, string> = fallback ? { ...fallback } : {};
      let found = false;
      for (let i = chain.length - 1; i >= 0; i--) {
        const localePath = join(chain[i].dir, "locales", `${lang}.json`);
        try {
          if (await chain[i].storage.exists(localePath)) {
            const text = await chain[i].storage.readText(localePath);
            const parsed = JSON.parse(text) as Record<string, string>;
            if (parsed && typeof parsed === "object") {
              Object.assign(merged, parsed);
              found = true;
            }
          }
        } catch {
          // Skip unreadable locale file, continue with the rest of the chain
        }
      }

      if (!found && !fallback) {
        localeCache.set(lang, {});
        return {};
      }
      localeCache.set(lang, merged);
      return merged;
    },

    /**
     * Get all available template names across the theme chain.
     */
    getAvailableTemplates(): string[] {
      const names = new Set<string>();
      let current: ResolvedTheme | undefined = theme;
      while (current) {
        for (const name of current.templateNames) {
          names.add(name);
        }
        current = current.parent;
      }
      return [...names];
    },

    /**
     * Clear the template cache (for dev mode hot-reload).
     * Increments the version counter so next imports use ?v=N,
     * forcing Deno to re-evaluate the module.
     */
    clearCache() {
      // Bump version for all currently cached files so Deno re-imports them
      for (const { absPath } of templateCache.values()) bumpVersion(absPath);
      for (const { absPath } of layoutCache.values()) bumpVersion(absPath);
      templateCache.clear();
      layoutCache.clear();
      localeCache.clear();
    },

    /**
     * Add extra template directories (e.g. from plugins loaded after the
     * theme loader was created). Clears the template cache so the new dirs
     * are searched on the next template load.
     */
    addTemplateDirs(dirs: string[]) {
      for (const dir of dirs) {
        if (!extraTemplateDirs.includes(dir)) {
          extraTemplateDirs.push(dir);
        }
      }
      templateCache.clear();
    },
  };
  return loader;
}

// === Internal helpers ===

/** Set of template paths already warned about, to avoid repeated messages. */
const _warnedTemplates = new Set<string>();

/**
 * True when the template source has a static component import but does NOT
 * use the documented Layout-prop fallback pattern. A static import is fine
 * as long as the Layout prop takes precedence, e.g.
 * `const LayoutComponent = Layout ?? StaticLayout;` — that pattern (or any
 * destructuring of `Layout` from props) suppresses the warning.
 */
export function hasUnsafeStaticLayoutImport(source: string): boolean {
  const hasStaticImport =
    /import\s+\w+\s+from\s+["'][^"']*\/components\/[^"']*["']/.test(source);
  if (!hasStaticImport) return false;
  const usesLayoutProp = /\bLayout\s*\?\?/.test(source) ||
    /[{,]\s*Layout\s*[},=:]/.test(source);
  return !usesLayoutProp;
}

/**
 * Check if a template file contains a static layout import and warn the
 * developer. Static imports like `import Layout from "../components/layout.tsx"`
 * won't be cache-busted during hot-reload — the template must use the `Layout`
 * prop passed by the router instead.
 */
async function warnStaticLayoutImport(templatePath: string, storage: StorageAdapter): Promise<void> {
  if (_warnedTemplates.has(templatePath)) return;
  try {
    const source = await storage.readText(templatePath);
    if (hasUnsafeStaticLayoutImport(source)) {
      _warnedTemplates.add(templatePath);
      console.warn(
        `  ⚠️  ${templatePath}: static layout import won't hot-reload.\n` +
        `     Use the Layout prop instead: const LayoutComponent = Layout ?? StaticLayout;`,
      );
    }
  } catch {
    // Can't read source — skip warning
  }
}

/**
 * Resolve a theme and its inheritance chain.
 */
interface ThemeResolveContext {
  siteStorage: StorageAdapter;
  siteRoot: string;
  themesDir: string;
  packages: ThemePackageIndex;
}

interface LocatedTheme {
  name: string;
  storage: StorageAdapter;
  dir: string;
  absoluteRoot: string;
  src?: string;
}

async function locateTheme(
  ref: string,
  ctx: ThemeResolveContext,
): Promise<LocatedTheme> {
  const trimmed = ref.trim();
  const resolvedSpec = await resolveThemeSpecifier(trimmed, ctx.siteRoot);

  const registeredRoot = ctx.packages.byName.get(trimmed);
  if (registeredRoot) {
    return await packageLocatedTheme(trimmed, registeredRoot, trimmed);
  }

  const normalized = normalizeThemeSpecifier(resolvedSpec);
  const srcRoot = ctx.packages.bySrc.get(normalized) ?? ctx.packages.bySrc.get(trimmed);
  if (srcRoot) {
    const name = ctx.packages.byName.has(trimmed)
      ? trimmed
      : defaultThemeNameFromSpecifier(resolvedSpec);
    return await packageLocatedTheme(name, srcRoot, isRemoteThemeSpecifier(resolvedSpec)
      ? resolvedSpec
      : undefined);
  }

  if (isRemoteThemeSpecifier(resolvedSpec) || isLocalThemePath(resolvedSpec)) {
    const root = await resolveThemePackageRoot(resolvedSpec, ctx.siteRoot);
    const name = defaultThemeNameFromSpecifier(resolvedSpec);
    return await packageLocatedTheme(
      name,
      root,
      isRemoteThemeSpecifier(resolvedSpec) ? resolvedSpec : undefined,
    );
  }

  // Local theme slug under themes/ — directory may not exist yet (empty/custom theme).
  const localDir = join(ctx.themesDir, trimmed);
  const absoluteRoot = ctx.themesDir
    ? join(ctx.siteRoot, localDir)
    : join(ctx.siteRoot, trimmed);
  return {
    name: trimmed,
    storage: ctx.siteStorage,
    dir: localDir,
    absoluteRoot,
  };
}

async function packageLocatedTheme(
  name: string,
  absoluteRoot: string,
  src?: string,
): Promise<LocatedTheme> {
  const { createStorage } = await import("../storage/mod.ts");
  return {
    name,
    storage: createStorage({ rootDir: absoluteRoot }),
    dir: "",
    absoluteRoot,
    src,
  };
}

async function resolveThemeChain(
  themeRef: string,
  ctx: ThemeResolveContext,
  visited: Set<string>,
  parentOverride?: string,
  activeSrc?: string,
  isRoot = true,
): Promise<ResolvedTheme> {
  const visitKey = themeRef.trim();
  if (visited.has(visitKey)) {
    throw new Error(
      `Circular theme inheritance detected: ${[...visited, visitKey].join(" → ")}`,
    );
  }
  visited.add(visitKey);

  let located: LocatedTheme;
  if (isRoot && activeSrc) {
    const root = ctx.packages.bySrc.get(normalizeThemeSpecifier(activeSrc)) ??
      await resolveThemePackageRoot(activeSrc, ctx.siteRoot);
    located = await packageLocatedTheme(themeRef, root, activeSrc);
  } else {
    located = await locateTheme(themeRef, ctx);
  }

  const manifest = await loadThemeManifest(
    located.storage,
    located.dir,
    located.name,
  );

  const templateNames = await discoverTemplates(located.storage, located.dir);
  const layoutNames = await discoverLayouts(located.storage, located.dir);

  const parentRef = isRoot ? (parentOverride ?? manifest.parent) : manifest.parent;
  let parent: ResolvedTheme | undefined;
  if (parentRef) {
    parent = await resolveThemeChain(parentRef, ctx, visited, undefined, undefined, false);
  }

  return {
    manifest,
    dir: located.dir,
    absoluteRoot: located.absoluteRoot,
    storage: located.storage,
    src: located.src,
    parent,
    templateNames,
    layoutNames,
  };
}

/**
 * Load theme.yaml manifest from a theme directory.
 */
async function loadThemeManifest(
  storage: StorageAdapter,
  themeDir: string,
  fallbackName: string,
): Promise<ThemeManifest> {
  const manifestPath = join(themeDir, "theme.yaml");

  try {
    if (await storage.exists(manifestPath)) {
      const { parse } = await import("@std/yaml");
      const text = await storage.readText(manifestPath);
      const parsed = parse(text);
      if (parsed && typeof parsed === "object") {
        const data = parsed as Record<string, unknown>;

        // Parse config_schema if present (must be a plain object, not an array)
        let configSchema: Record<string, import("../blueprints/types.ts").BlueprintField> | undefined;
        if (
          data.config_schema &&
          typeof data.config_schema === "object" &&
          !Array.isArray(data.config_schema)
        ) {
          configSchema = data.config_schema as Record<string, import("../blueprints/types.ts").BlueprintField>;
        }

        return {
          name: (data.name as string) ?? fallbackName,
          parent: data.parent as string | undefined,
          description: data.description as string | undefined,
          author: data.author as string | undefined,
          version: data.version as string | undefined,
          configSchema,
        };
      }
    }
  } catch {
    // Failed to parse manifest — use defaults
  }

  return { name: fallbackName };
}

/**
 * Discover available template names in a theme's templates/ directory.
 */
async function discoverTemplates(
  storage: StorageAdapter,
  themeDir: string,
): Promise<string[]> {
  const templatesDir = join(themeDir, "templates");
  const names: string[] = [];

  try {
    const entries = await storage.list(templatesDir);
    for (const entry of entries) {
      if (!entry.isFile) continue;
      if (!entry.name.endsWith(".tsx")) continue;
      // "post.tsx" → "post"
      names.push(entry.name.replace(/\.tsx$/, ""));
    }
  } catch {
    // No templates directory
  }

  return names;
}

/**
 * Discover available layout names in a theme's components/ directory.
 */
async function discoverLayouts(
  storage: StorageAdapter,
  themeDir: string,
): Promise<string[]> {
  const componentsDir = join(themeDir, "components");
  const names: string[] = [];

  try {
    const entries = await storage.list(componentsDir);
    for (const entry of entries) {
      if (!entry.isFile) continue;
      if (!entry.name.endsWith(".tsx")) continue;
      names.push(entry.name.replace(/\.tsx$/, ""));
    }
  } catch {
    // No components directory
  }

  return names;
}

