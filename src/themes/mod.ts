/**
 * Theme system — template loading, inheritance, layout resolution.
 */

export { createThemeLoader } from "./loader.ts";
export type { ThemeLoader, ThemeLoaderOptions } from "./loader.ts";
export type { ThemeManifest, ResolvedTheme, LoadedTemplate } from "./types.ts";
