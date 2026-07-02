/**
 * Theme system — template loading, inheritance, layout resolution.
 */

export { createThemeLoader, collectThemeIslands, collectContentIslands } from "./loader.ts";
export { resolveTemplateVNode } from "./resolve-template.ts";
export type { ThemeLoader, ThemeLoaderOptions } from "./loader.ts";
export type { ThemeManifest, ResolvedTheme, LoadedTemplate } from "./types.ts";
export {
  assertPinnedThemeSpecifier,
  assertThemeName,
  defaultThemeNameFromSpecifier,
  importKeyForThemeSpecifier,
  isRemoteThemeSpecifier,
  normalizeThemeSpecifier,
  resolveThemePackageRoot,
  resolveThemeSpecifier,
} from "./reference.ts";
export {
  buildThemePackageIndex,
  buildThemePackageStaticDirs,
  type ThemePackageIndex,
} from "./packages.ts";
