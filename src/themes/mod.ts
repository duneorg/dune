/**
 * Theme system — template loading, inheritance, layout resolution.
 */

export { collectContentIslands, collectThemeIslands, createThemeLoader } from "./loader.ts";
export { resolveTemplateVNode } from "./resolve-template.ts";
export type { ThemeLoader, ThemeLoaderOptions } from "./loader.ts";
export type { LoadedTemplate, ResolvedTheme, ThemeManifest } from "./types.ts";
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
