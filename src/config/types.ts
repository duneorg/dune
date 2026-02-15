/**
 * Configuration type definitions for Dune CMS.
 */

/** Top-level Dune configuration (result of merging all config sources) */
export interface DuneConfig {
  site: SiteConfig;
  system: SystemConfig;
  theme: ThemeConfig;
  plugins: Record<string, Record<string, unknown>>;
  /** Admin panel configuration (optional — defaults applied if omitted) */
  admin?: AdminConfig;
}

/** Admin panel configuration */
export interface AdminConfig {
  /** Admin panel route prefix (default: "/admin") */
  path: string;
  /** Session lifetime in seconds (default: 86400 = 24h) */
  sessionLifetime: number;
  /** Admin data directory (default: ".dune/admin") */
  dataDir: string;
  /** Whether admin panel is enabled (default: true) */
  enabled: boolean;
}

/** Site-level configuration (content, identity, metadata) */
export interface SiteConfig {
  title: string;
  description: string;
  url: string;
  author: {
    name: string;
    email?: string;
  };
  /** Folder slug or route that serves as homepage. Autodetected if omitted.
   * When omitted, the first ordered top-level folder (lowest numeric prefix) is used.
   * @example "home" | "efficiency" | "landing"
   */
  home?: string;
  metadata: Record<string, string>;
  /** Taxonomy types enabled for this site */
  taxonomies: string[];
  /** Route aliases: { "/old": "/new" } */
  routes: Record<string, string>;
  /** Redirects: { "/old": "/new" } (301 by default) */
  redirects: Record<string, string>;
}

/** System-level configuration (engine behavior) */
export interface SystemConfig {
  content: {
    dir: string;
    markdown: {
      extra: boolean;
      auto_links: boolean;
      auto_url_links: boolean;
    };
  };
  cache: {
    enabled: boolean;
    driver: "memory" | "filesystem" | "kv";
    lifetime: number;
    check: "file" | "hash" | "none";
  };
  images: {
    default_quality: number;
    cache_dir: string;
    allowed_sizes: number[];
  };
  languages: {
    supported: string[];
    default: string;
    include_default_in_url: boolean;
  };
  /** Typography options (orphan protection, etc.) */
  typography?: {
    /** Insert &nbsp; before last word of paragraphs to avoid orphans (default: true) */
    orphan_protection?: boolean;
  };
  debug: boolean;
  timezone: string;
}

/** Theme configuration */
export interface ThemeConfig {
  name: string;
  parent?: string;
  custom: Record<string, unknown>;
}

/** Source annotation for config inspector */
export interface ConfigSource {
  value: unknown;
  source: string; // e.g., "config/site.yaml:3" or "default"
}
