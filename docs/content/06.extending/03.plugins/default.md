---
title: "Creating Plugins"
published: true
visible: true
taxonomy:
  audience: [developer]
  difficulty: [advanced]
  topic: [extending, plugins]
metadata:
  description: "Bundling hooks and configuration into distributable plugins"
---

# Creating Plugins

A plugin is a TypeScript module that bundles hooks, configuration defaults, and an optional config schema into a distributable package.

## Plugin structure

```typescript
import type { DunePlugin } from "dune/types";

const myPlugin: DunePlugin = {
  name: "dune-seo",
  version: "1.0.0",

  // Optional: schema for plugin-specific config
  configSchema: {
    sitemap: { type: "boolean", default: true },
    robots: { type: "boolean", default: true },
  },

  hooks: {
    onContentIndexReady: async ({ data, config, storage }) => {
      const pluginConfig = config.plugins["dune-seo"] ?? {};

      if (pluginConfig.sitemap !== false) {
        // Generate sitemap.xml from the content index
        const sitemap = generateSitemap(data.pages, config.site.url);
        await storage.write("static/sitemap.xml", sitemap);
      }
    },

    onAfterRender: async ({ data, config }) => {
      const pluginConfig = config.plugins["dune-seo"] ?? {};

      if (pluginConfig.robots !== false) {
        // Inject robots meta tag based on page frontmatter
        const robots = data.page.frontmatter.metadata?.robots ?? "index, follow";
        data.html = data.html.replace(
          "</head>",
          `<meta name="robots" content="${robots}"></head>`,
        );
      }
    },
  },
};

export default myPlugin;
```

## Plugin configuration

Users configure plugins in their site config:

```yaml
# dune.config.ts or merged from YAML
plugins:
  dune-seo:
    sitemap: true
    robots: true
  dune-analytics:
    provider: "plausible"
    domain: "example.com"
```

The plugin accesses its config via `config.plugins["plugin-name"]`.

## Loading plugins

```typescript
// dune.config.ts
import seoPlugin from "jsr:@dune/seo";
import analyticsPlugin from "./plugins/analytics.ts";

export default {
  plugins: {
    "dune-seo": { sitemap: true },
    "dune-analytics": { provider: "plausible" },
  },
};
```

## Distribution

Plugins are standard Deno/TypeScript modules. Distribute them via:

- **JSR** (recommended): `jsr:@dune/plugin-name`
- **npm**: `npm:dune-plugin-name`
- **URL import**: `https://example.com/plugin.ts`
- **Local**: `./plugins/my-plugin.ts`

## Plugin best practices

**Namespace your config.** Use a unique plugin name in `config.plugins`.

**Provide defaults.** Don't require users to configure every option. Use sensible defaults and let users override.

**Fail gracefully.** If a plugin can't do its job (missing config, network error), log a warning — don't crash the site.

**Document hooks used.** Tell users which lifecycle events your plugin intercepts so they understand the performance implications.
