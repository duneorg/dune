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
 *   Deno caches `import()` by URL. A `?v=N` query on a parent module
 *   does NOT bust the cache of its static imports. To reload the full
 *   module graph (template → layout → helpers), we copy .tsx files to
 *   a versioned temp directory so every URL in the graph is new.
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
}

/**
 * Create a theme loader that discovers and loads theme templates.
 */
export async function createThemeLoader(options: ThemeLoaderOptions) {
  const { storage, themesDir, themeName, rootDir } = options;

  // Resolve the theme chain (child → parent → grandparent...)
  const theme = await resolveTheme(storage, themesDir, themeName);

  // Template component cache (lazy-loaded on first use)
  const templateCache = new Map<string, TemplateComponent>();
  const layoutCache = new Map<string, TemplateComponent>();

  // Hot-reload: version counter and temp dir for module graph cache busting
  let importVersion = 0;
  let snapshotDir: string | null = null;

  /**
   * Get the import URL for a theme file.
   * Version 0 (initial load): import from the real path.
   * Version 1+ (after clearCache): import from a snapshot that mirrors the
   * repo root. Theme .tsx files are copied (fresh URLs → full module graph
   * reload), while everything else is symlinked so relative imports that
   * reach outside the theme (e.g., "../../../../src/content/types.ts") resolve.
   */
  async function getImportPath(realAbsPath: string): Promise<string> {
    if (importVersion === 0) {
      return `file://${realAbsPath}`;
    }

    // Ensure the snapshot exists for this version
    if (!snapshotDir) {
      snapshotDir = await createThemeSnapshot();
    }
    // Map real absolute path → snapshot absolute path
    const repoRoot = await findRepoRoot(rootDir || Deno.cwd());
    const relative = realAbsPath.slice(repoRoot.length);
    const snapshotPath = join(snapshotDir, relative);
    return `file://${snapshotPath}`;
  }

  /**
   * Create a versioned snapshot mirroring the repo root.
   *
   * Strategy:
   *   1. Find the repo root (walk up looking for .git or deno.json).
   *   2. Create /tmp/dune-themes/v{N}/ mirroring that root.
   *   3. Symlink all top-level entries from the repo root.
   *   4. "Unpack" the path down to each theme dir: replace symlinks with
   *      real directories whose children are symlinked, until we reach
   *      the theme's templates/ and components/ dirs.
   *   5. Copy .tsx files into those dirs (fresh copies → new module URLs).
   *
   * Since every theme file URL is new, Deno re-evaluates the full module
   * graph. Symlinks ensure non-theme relative imports still resolve.
   */
  async function createThemeSnapshot(): Promise<string> {
    const repoRoot = await findRepoRoot(rootDir || Deno.cwd());
    // Place snapshot INSIDE the repo root so Deno's import map (deno.json)
    // applies to the copied .tsx files. Bare specifiers like "preact" only
    // resolve when the importing file is under the deno.json scope.
    const tmpBase = join(repoRoot, ".dune-cache", "themes");
    const versionedDir = join(tmpBase, `v${importVersion}`);

    // Clean up previous version if it exists
    try {
      await Deno.remove(versionedDir, { recursive: true });
    } catch {
      // Doesn't exist yet
    }
    await Deno.mkdir(versionedDir, { recursive: true });

    // Step 1: Symlink all top-level entries in the repo root (skip .dune-cache itself)
    for await (const entry of Deno.readDir(repoRoot)) {
      if (entry.name === ".dune-cache") continue;
      try {
        await Deno.symlink(
          join(repoRoot, entry.name),
          join(versionedDir, entry.name),
        );
      } catch {
        // Already exists
      }
    }

    // Step 2: For each theme in the chain, "unpack" the path from repo root
    // down to the theme dir, then copy .tsx files.
    let current: ResolvedTheme | undefined = theme;
    while (current) {
      const absThemeDir = await resolveAbsPath(current.dir, rootDir);
      const relFromRepo = absThemeDir.slice(repoRoot.length); // e.g. /zumbrunn.com/themes/starter
      const segments = relFromRepo.split("/").filter(Boolean);

      // Unpack each segment: replace symlink with real dir + symlinked children
      let currentPath = versionedDir;
      let realPath = repoRoot;
      for (const segment of segments) {
        currentPath = join(currentPath, segment);
        realPath = join(realPath, segment);
        try {
          const info = await Deno.lstat(currentPath);
          if (info.isSymlink) {
            await Deno.remove(currentPath);
            await Deno.mkdir(currentPath, { recursive: true });
            // Symlink children of the real directory
            for await (const child of Deno.readDir(realPath)) {
              try {
                await Deno.symlink(
                  join(realPath, child.name),
                  join(currentPath, child.name),
                );
              } catch {
                // Already exists
              }
            }
          }
        } catch {
          // Path doesn't exist yet — create it
          await Deno.mkdir(currentPath, { recursive: true });
        }
      }

      // Now currentPath points to the unpacked theme dir in the snapshot.
      // Replace templates/ and components/ symlinks with real dirs + copied .tsx files.
      for (const subdir of ["templates", "components"]) {
        const srcDir = join(absThemeDir, subdir);
        const destDir = join(currentPath, subdir);

        // Remove symlink if it exists
        try {
          const info = await Deno.lstat(destDir);
          if (info.isSymlink) {
            await Deno.remove(destDir);
          }
        } catch {
          // Doesn't exist
        }

        try {
          await Deno.mkdir(destDir, { recursive: true });
          for await (const entry of Deno.readDir(srcDir)) {
            if (!entry.isFile || !entry.name.endsWith(".tsx")) continue;
            await Deno.copyFile(
              join(srcDir, entry.name),
              join(destDir, entry.name),
            );
          }
        } catch {
          // Source directory doesn't exist — skip
        }
      }

      current = current.parent;
    }

    // Clean up older snapshot versions (keep only current)
    try {
      for await (const entry of Deno.readDir(tmpBase)) {
        if (entry.isDirectory && entry.name !== `v${importVersion}`) {
          try {
            await Deno.remove(join(tmpBase, entry.name), { recursive: true });
          } catch {
            // Best effort cleanup
          }
        }
      }
    } catch {
      // tmpBase might not exist yet
    }

    return versionedDir;
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
            const fileUrl = await getImportPath(absPath);
            const mod = await import(fileUrl);
            const component = mod.default as TemplateComponent;
            if (component) {
              templateCache.set(name, component);
              return { name, component, fromTheme: current.manifest.name };
            }
          }
        } catch (_err) {
          // Template file exists but failed to load — continue to parent
        }
        current = current.parent;
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
            const fileUrl = await getImportPath(absPath);
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
     * Increments the version so next load creates a fresh temp snapshot,
     * ensuring the entire module graph (templates + layouts + helpers) is re-imported.
     */
    clearCache() {
      templateCache.clear();
      layoutCache.clear();
      importVersion++;
      snapshotDir = null; // Force new snapshot on next load
    },
  };
}

// === Internal helpers ===

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
        return {
          name: (data.name as string) ?? fallbackName,
          parent: data.parent as string | undefined,
          description: data.description as string | undefined,
          author: data.author as string | undefined,
          version: data.version as string | undefined,
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

/**
 * Walk up from a starting directory to find the repo/project root.
 *
 * Prioritises .git (the true repo root) over deno.json, because a
 * monorepo may have deno.json files in subdirectories (e.g. site roots).
 * Falls back to the nearest deno.json/deno.jsonc, then the starting dir.
 */
async function findRepoRoot(startDir: string): Promise<string> {
  let dir = await Deno.realPath(startDir);
  const fsRoot = "/";
  let denoJsonDir: string | null = null;

  while (dir !== fsRoot) {
    // .git is the definitive repo root — return immediately
    try {
      await Deno.stat(join(dir, ".git"));
      return dir;
    } catch {
      // Not found
    }

    // Remember the first deno.json we find as a fallback
    if (!denoJsonDir) {
      for (const name of ["deno.json", "deno.jsonc"]) {
        try {
          await Deno.stat(join(dir, name));
          denoJsonDir = dir;
        } catch {
          // Not found
        }
      }
    }

    const parent = join(dir, "..");
    const resolved = await Deno.realPath(parent);
    if (resolved === dir) break; // Reached filesystem root
    dir = resolved;
  }

  // No .git found — fall back to deno.json location, then starting dir
  return denoJsonDir ?? await Deno.realPath(startDir);
}

export type ThemeLoader = Awaited<ReturnType<typeof createThemeLoader>>;
