/**
 * Config module — public API for configuration loading and management.
 */

export type { ConfigSource, DuneConfig, SiteConfig, SystemConfig, ThemeConfig } from "./types.ts";
export { DEFAULT_CONFIG } from "./defaults.ts";
export { deepMerge, detectEnvironment, loadConfig } from "./loader.ts";
export type { LoadConfigOptions } from "./loader.ts";
export { validateConfig } from "./validator.ts";
export type { ValidationError } from "./validator.ts";
