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

import { join } from "@std/path";
import type { StorageAdapter } from "../storage/types.ts";
import type { TemplateComponent, Page } from "../content/types.ts";
import type { ThemeManifest, ResolvedTheme, LoadedTemplate } from "./types.ts";

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
}

/**
 * Create a theme loader that discovers and loads theme templates.
 */
export async function createThemeLoader(options: ThemeLoaderOptions) {
  const { storage, themesDir, themeName, rootDir } = options;

  // Resolve the theme chain (child → parent → grandparent...)
  const theme = await resolveTheme(storage, themesDir, themeName);

  // Mutable list of extra template dirs (populated after plugin loading).
  const extraTemplateDirs: string[] = [...(options.extraTemplateDirs ?? [])];

  // Template component cache (lazy-loaded on first use)
  const templateCache = new Map<string, TemplateComponent>();
  const layoutCache = new Map<string, TemplateComponent>();
  const localeCache = new Map<string, Record<string, string>>();

  // Hot-reload: version counter for ?v=N cache busting
  let importVersion = 0;

  /**
   * Get the import URL for a theme file.
   * Version 0 (initial load): plain file URL.
   * Version 1+ (after clearCache): append ?v=N to bust Deno's module cache.
   */
  function getImportUrl(absPath: string): string {
    const base = `file://${absPath}`;
    return importVersion === 0 ? base : `${base}?v=${importVersion}`;
  }

  return {
    /** The resolved theme with inheritance chain */
    theme,

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
      // Check cache first
      const cached = templateCache.get(name);
      if (cached) {
        return {
          name,
          component: cached,
          fromTheme: theme.manifest.name,
        };
      }

      // Walk the theme chain: child → parent → grandparent
      let current: ResolvedTheme | undefined = theme;
      while (current) {
        const templatePath = join(current.dir, "templates", `${name}.tsx`);
        try {
          if (await storage.exists(templatePath)) {
            const absPath = await resolveAbsPath(templatePath, rootDir);
            const fileUrl = getImportUrl(absPath);
            const mod = await import(fileUrl);
            const component = mod.default as TemplateComponent;
            if (component) {
              // Warn about static layout imports that break hot-reload
              warnStaticLayoutImport(templatePath, storage);
              templateCache.set(name, component);
              return { name, component, fromTheme: current.manifest.name };
            }
          }
        } catch (_err) {
          // Template file exists but failed to load — continue to parent
        }
        current = current.parent;
      }

      // Fallback: check plugin template directories (lowest priority)
      for (const dir of extraTemplateDirs) {
        const templatePath = join(dir, `${name}.tsx`);
        try {
          const stat = await Deno.stat(templatePath);
          if (stat.isFile) {
            const fileUrl = getImportUrl(templatePath);
            const mod = await import(fileUrl);
            const component = mod.default as TemplateComponent;
            if (component) {
              templateCache.set(name, component);
              return { name, component, fromTheme: "(plugin)" };
            }
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
      // Check cache
      const cached = layoutCache.get(name);
      if (cached) return cached;

      // Walk theme chain
      let current: ResolvedTheme | undefined = theme;
      while (current) {
        const layoutPath = join(current.dir, "components", `${name}.tsx`);
        try {
          if (await storage.exists(layoutPath)) {
            const absPath = await resolveAbsPath(layoutPath, rootDir);
            const fileUrl = getImportUrl(absPath);
            const mod = await import(fileUrl);
            const component = mod.default as TemplateComponent;
            if (component) {
              layoutCache.set(name, component);
              return component;
            }
          }
        } catch {
          // Continue to parent
        }
        current = current.parent;
      }

      return null;
    },

    /**
     * Load theme UI locale strings for a language.
     * Looks in themes/{theme}/locales/{lang}.json across the theme chain.
     * Falls back to "en" if the requested language is not found.
     * Returns a flat object of key → string for use with t(key).
     */
    async loadLocale(lang: string): Promise<Record<string, string>> {
      const cached = localeCache.get(lang);
      if (cached) return cached;

      const fallback = lang !== "en" ? await this.loadLocale("en") : null;
      let current: ResolvedTheme | undefined = theme;
      while (current) {
        const localePath = join(current.dir, "locales", `${lang}.json`);
        try {
          if (await storage.exists(localePath)) {
            const text = await storage.readText(localePath);
            const parsed = JSON.parse(text) as Record<string, string>;
            if (parsed && typeof parsed === "object") {
              const merged = fallback ? { ...fallback, ...parsed } : parsed;
              localeCache.set(lang, merged);
              return merged;
            }
          }
        } catch {
          // Continue to parent theme
        }
        current = current.parent;
      }

      if (fallback) {
        localeCache.set(lang, fallback);
        return fallback;
      }
      localeCache.set(lang, {});
      return {};
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
      templateCache.clear();
      layoutCache.clear();
      localeCache.clear();
      importVersion++;
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
}

// === Internal helpers ===

/** Set of template paths already warned about, to avoid repeated messages. */
const _warnedTemplates = new Set<string>();

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
    // Match: import <anything> from "<path containing /components/>"
    if (/import\s+\w+\s+from\s+["'][^"']*\/components\/[^"']*["']/.test(source)) {
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
async function resolveTheme(
  storage: StorageAdapter,
  themesDir: string,
  themeName: string,
  visited: Set<string> = new Set(),
): Promise<ResolvedTheme> {
  // Circular inheritance guard
  if (visited.has(themeName)) {
    throw new Error(`Circular theme inheritance detected: ${[...visited, themeName].join(" → ")}`);
  }
  visited.add(themeName);

  const themeDir = join(themesDir, themeName);

  // Load theme manifest
  const manifest = await loadThemeManifest(storage, themeDir, themeName);

  // Discover templates
  const templateNames = await discoverTemplates(storage, themeDir);
  const layoutNames = await discoverLayouts(storage, themeDir);

  // Resolve parent theme if specified
  let parent: ResolvedTheme | undefined;
  if (manifest.parent) {
    parent = await resolveTheme(storage, themesDir, manifest.parent, visited);
  }

  return {
    manifest,
    dir: themeDir,
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

/**
 * Resolve absolute path for dynamic import.
 */
async function resolveAbsPath(relativePath: string, rootDir?: string): Promise<string> {
  const baseDir = rootDir || Deno.cwd();
  try {
    // Try relative to rootDir first
    const fullPath = join(baseDir, relativePath);
    return await Deno.realPath(fullPath);
  } catch {
    // Fallback to cwd
    try {
      return await Deno.realPath(relativePath);
    } catch {
      return await Deno.realPath(join(Deno.cwd(), relativePath));
    }
  }
}

export type ThemeLoader = Awaited<ReturnType<typeof createThemeLoader>>;
