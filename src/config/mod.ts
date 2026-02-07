/**
 * Config module — public API for configuration loading and management.
 */

export type { DuneConfig, SiteConfig, SystemConfig, ThemeConfig, ConfigSource } from "./types.ts";
export { DEFAULT_CONFIG } from "./defaults.ts";
export { loadConfig, deepMerge, detectEnvironment } from "./loader.ts";
export type { LoadConfigOptions } from "./loader.ts";
export { validateConfig } from "./validator.ts";
export type { ValidationError } from "./validator.ts";
