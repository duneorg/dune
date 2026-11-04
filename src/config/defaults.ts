/**
 * System defaults — the base configuration that everything merges onto.
 * These values are used when no config file specifies otherwise.
 */

import type { DuneConfig } from "./types.ts";

export const DEFAULT_CONFIG: DuneConfig = {
  site: {
    title: "Dune Site",
    description: "",
    url: "http://localhost:8000",
    author: {
      name: "",
    },
    metadata: {},
    taxonomies: ["category", "tag"],
    routes: {},
    redirects: {},
  },
  system: {
    content: {
      dir: "content",
      markdown: {
        extra: true,
        auto_links: true,
        auto_url_links: true,
      },
      allow_tsx_format: ["admin"],
    },
    cache: {
      enabled: true,
      driver: "filesystem",
      lifetime: 3600,
      check: "file",
    },
    images: {
      default_quality: 80,
      cache_dir: ".dune/cache/images",
      allowed_sizes: [320, 640, 768, 1024, 1280, 1536, 1920],
    },
    languages: {
      supported: ["en"],
      default: "en",
      include_default_in_url: false,
    },
    typography: {
      orphan_protection: true,
    },
    debug: false,
    timezone: "UTC",
  },
  theme: {
    name: "default",
    custom: {},
  },
  plugins: {},
  pluginList: [],
  themeList: [],
  autoDiscoverPlugins: false,
  admin: {
    path: "/admin",
    session_lifetime: 86400,
    data_dir: "data",
    runtime_dir: ".dune/admin",
    enabled: true,
    max_revisions: 50,
    max_upload_mb: 100,
  },
};
