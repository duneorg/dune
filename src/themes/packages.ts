/**
 * Build an index of installed theme packages from site configuration.
 */

import type { ThemePackageEntry } from "../config/types.ts";
import {
  normalizeThemeSpecifier,
  resolveThemePackageRoot,
} from "./reference.ts";

/** Resolved theme package locations keyed by logical name and by specifier. */
export interface ThemePackageIndex {
  /** Theme name → absolute package root (directory containing theme.yaml). */
  byName: ReadonlyMap<string, string>;
  /** Normalized specifier → absolute package root. */
  bySrc: ReadonlyMap<string, string>;
}

export interface BuildThemePackageIndexOptions {
  siteRoot: string;
  /** Entries from site.yaml `themes:` list. */
  packages: ThemePackageEntry[];
  /** Active theme when it is package-backed via `theme.src`. */
  active?: { name: string; src: string };
}

/**
 * Resolve all declared theme packages and return lookup maps for the loader.
 * Failures are propagated — bootstrap should surface a clear config error.
 */
export async function buildThemePackageIndex(
  options: BuildThemePackageIndexOptions,
): Promise<ThemePackageIndex> {
  const byName = new Map<string, string>();
  const bySrc = new Map<string, string>();
  const { siteRoot, packages, active } = options;

  async function register(name: string, src: string): Promise<void> {
    const normalized = normalizeThemeSpecifier(src);
    if (bySrc.has(normalized)) {
      byName.set(name, bySrc.get(normalized)!);
      return;
    }
    const root = await resolveThemePackageRoot(src, siteRoot);
    byName.set(name, root);
    bySrc.set(normalized, root);
    bySrc.set(src, root);
  }

  for (const entry of packages) {
    await register(entry.name, entry.src);
  }

  if (active?.src) {
    await register(active.name, active.src);
  }

  return { byName, bySrc };
}

/** Absolute path to a theme's static/ directory when package-backed. */
export function themeStaticDir(packageRoot: string): string {
  return `${packageRoot}/static`;
}

/** Collect static directory paths for all registered package themes. */
export function buildThemePackageStaticDirs(
  index: ThemePackageIndex,
): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const [name, root] of index.byName) {
    map.set(name, themeStaticDir(root));
  }
  return map;
}
