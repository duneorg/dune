---
title: "Plugins"
published: true
visible: true
taxonomy:
  audience: [developer]
  difficulty: [intermediate]
  topic: [extending, plugins]
metadata:
  description: "Creating, installing, and distributing Dune CMS plugins"
---

# Plugins

A plugin is a TypeScript module that bundles hooks, a config schema, and optional setup logic into a distributable package. Plugins are loaded at startup from your `config/site.yaml` and can be managed from the admin panel at **Plugins** (🔌).

## Installing a plugin

Add a `plugins:` list to `config/site.yaml`. Each entry needs at minimum a `src` pointing to the plugin module:

```yaml
# config/site.yaml
plugins:
  - src: "./plugins/my-plugin/mod.ts"
  - src: "jsr:@dune/seo"
    config:
      sitemap: true
      robots: true
  - src: "npm:dune-analytics"
    config:
      provider: plausible
      domain: example.com
```

Or use the CLI:

```bash
dune plugin:install ./plugins/my-plugin/mod.ts
dune plugin:install jsr:@dune/seo
```

This adds the entry to `site.yaml` automatically. Run `dune dev` to activate it.

### Plugin source formats

| Format | Example | Description |
|--------|---------|-------------|
| Local path | `./plugins/my-plugin/mod.ts` | TypeScript file relative to site root |
| JSR | `jsr:@scope/plugin-name` | Package from the JSR registry |
| npm | `npm:dune-plugin-name` | npm package (resolved via Deno) |
| HTTPS | `https://example.com/plugin.ts` | Arbitrary URL import |

## Plugin module format

A plugin module must export a `DunePlugin` as its **default export**, either as a plain object or as a factory function.

### Object form

Use this when your plugin does not need configuration:

```typescript
// plugins/logger/mod.ts
import type { DunePlugin } from "../../src/hooks/types.ts";

export default {
  name: "logger",
  version: "1.0.0",
  description: "Logs every request to the console",
  author: "Your Name",

  hooks: {
    onRequest: ({ data }) => {
      const url = new URL(data.req.url);
      console.log(`[${new Date().toISOString()}] ${data.req.method} ${url.pathname}`);
    },
  },
} satisfies DunePlugin;
```

### Factory form

Use this when your plugin needs to read its config at initialization time. The factory receives the merged plugin config (site.yaml static config merged with any admin-saved overrides):

```typescript
// plugins/analytics/mod.ts
import type { DunePlugin } from "../../src/hooks/types.ts";

export interface AnalyticsConfig {
  provider?: "plausible" | "umami";
  domain?: string;
  enabled?: boolean;
}

export default function createAnalytics(config: AnalyticsConfig = {}): DunePlugin {
  const { provider = "plausible", domain = "", enabled = true } = config;

  return {
    name: "analytics",
    version: "1.0.0",
    description: "Privacy-focused page view analytics",

    hooks: {
      onAfterRender: ({ data }) => {
        if (!enabled || !domain) return;

        const snippet = provider === "plausible"
          ? `<script defer data-domain="${domain}" src="https://plausible.io/js/script.js"></script>`
          : `<script async src="https://analytics.umami.is/script.js" data-website-id="${domain}"></script>`;

        data.html = data.html.replace("</head>", `${snippet}\n</head>`);
      },
    },
  };
}
```

## Plugin fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | ✅ | Unique identifier — used as the key in `config.plugins` |
| `version` | ✅ | SemVer version string |
| `description` | — | Human-readable description shown in the admin panel |
| `author` | — | Author name or contact shown in the admin panel |
| `hooks` | ✅ | Map of hook event names to handler functions (can be empty `{}`) |
| `configSchema` | — | Blueprint-style field definitions for admin-driven config UI |
| `setup` | — | One-time initialization function called when the plugin is registered |

## Config schema

When `configSchema` is defined, the admin panel renders a typed form for the plugin's settings. Users can edit config values without touching `site.yaml`. Changes are saved to `data/plugins/{name}.json` and loaded at the next startup.

```typescript
import type { DunePlugin } from "../../src/hooks/types.ts";

export default function createSeo(config = {}): DunePlugin {
  return {
    name: "dune-seo",
    version: "1.0.0",
    description: "SEO automation: sitemap, robots meta, canonical URLs",

    configSchema: {
      sitemap: {
        type: "toggle",
        label: "Generate sitemap.xml",
        default: true,
      },
      robots: {
        type: "toggle",
        label: "Add robots meta tag",
        default: true,
      },
      default_robots: {
        type: "text",
        label: "Default robots value",
        default: "index, follow",
      },
      changefreq: {
        type: "select",
        label: "Sitemap change frequency",
        options: {
          always: "Always",
          hourly: "Hourly",
          daily: "Daily",
          weekly: "Weekly",
          monthly: "Monthly",
          yearly: "Yearly",
          never: "Never",
        },
        default: "weekly",
      },
    },

    hooks: {
      onContentIndexReady: async ({ data, config: cfg, storage }) => {
        const pluginCfg = cfg.plugins["dune-seo"] ?? {};
        if (pluginCfg.sitemap === false) return;
        // … generate sitemap
      },
    },
  };
}
```

Config schema fields use the same types as [Flex Object fields](/flex-objects#field-types): `text`, `textarea`, `number`, `toggle`, `date`, `select`, `color`.

## The `setup()` function

`setup()` is called once when the plugin is registered — before any hook events fire. It receives a `PluginApi` object:

```typescript
interface PluginApi {
  /** Hook registry — register additional hooks dynamically */
  hooks: HookRegistry;
  /** Merged configuration (read-only) */
  config: DuneConfig;
  /** Storage adapter — read and write plugin-specific data */
  storage: StorageAdapter;
}
```

Use `setup()` for one-time initialization that needs access to the storage layer or config, or when you need to register hooks conditionally:

```typescript
export default function createCache(config: CacheConfig = {}): DunePlugin {
  return {
    name: "edge-cache",
    version: "1.0.0",

    setup: async ({ hooks, config: cfg, storage }) => {
      // Only register cache-clearing hooks if a purge URL is configured
      const purgeUrl = (cfg.plugins["edge-cache"] as CacheConfig)?.purge_url;
      if (!purgeUrl) return;

      hooks.on("onCacheInvalidate", async ({ data }) => {
        await fetch(`${purgeUrl}?key=${data.key}`, { method: "POST" });
      });

      // Verify the purge endpoint is reachable at startup
      try {
        await fetch(purgeUrl, { method: "HEAD" });
        console.log("[edge-cache] Purge endpoint reachable ✓");
      } catch {
        console.warn("[edge-cache] Purge endpoint unreachable — cache clearing disabled");
      }
    },

    hooks: {},
  };
}
```

## Accessing plugin config in hooks

Plugin config is always available in hook handlers via `config.plugins["plugin-name"]`. Config comes from three merged sources (last wins):

1. Default values from your plugin code
2. Static config in `site.yaml` under the `config:` key
3. Admin-saved overrides from `data/plugins/{name}.json`

```typescript
hooks: {
  onAfterRender: ({ data, config }) => {
    // config.plugins["my-plugin"] is the fully merged config object
    const myConfig = (config.plugins["my-plugin"] ?? {}) as MyPluginConfig;
    if (!myConfig.enabled) return;
    // …
  },
},
```

## CLI commands

| Command | Description |
|---------|-------------|
| `dune plugin:list` | List all installed plugins with their hooks and config fields |
| `dune plugin:install <src>` | Add a plugin to `config/site.yaml` |
| `dune plugin:remove <src\|name>` | Remove a plugin from `config/site.yaml` |
| `dune plugin:create [name]` | Scaffold a new plugin project in `plugins/{name}/` |

### `dune plugin:create`

Scaffolds a fully-typed plugin template in `plugins/{name}/`:

```bash
dune plugin:create dune-social
```

Creates:

```
plugins/dune-social/
  mod.ts        ← plugin with example hooks + typed config interface
  deno.json     ← JSR package metadata
  README.md     ← installation and configuration docs
```

The generated `mod.ts` exports a factory function and is ready to register in `site.yaml`.

### `dune plugin:list`

```bash
$ dune plugin:list

Installed plugins (2):

  dune-seo@1.0.0 by Jane Doe  — SEO automation: sitemap, robots meta, canonical URLs
    hooks: onContentIndexReady, onAfterRender
    config fields: sitemap, robots, default_robots, changefreq

  analytics@0.2.0
    hooks: onAfterRender
```

## Admin panel

Open **Plugins** (🔌) in the admin sidebar to see all installed plugins. For each plugin that defines a `configSchema`, a **Config** form is rendered automatically. Changes are saved immediately and take effect on the next server restart.

Config saved via the admin panel is stored in `data/plugins/{name}.json`. This file is git-tracked so config changes are part of your deployment.

## Scaffolding a local plugin

The fastest way to start a plugin:

```bash
# Create the scaffold
dune plugin:create my-shortcodes

# Register it
# (plugin:create prints the site.yaml snippet — copy it, or:)
dune plugin:install ./plugins/my-shortcodes/mod.ts

# Start developing
dune dev
```

Edit `plugins/my-shortcodes/mod.ts`, add hooks, and the dev server will reload on save.

## Distribution

Plugins are standard Deno/TypeScript modules. Publish them so others can install them with a single `src:` line.

**JSR (recommended)** — free, TypeScript-native, scoped packages:

```bash
# In your plugin directory
deno publish
```

Users install with:

```yaml
plugins:
  - src: "jsr:@yourscope/dune-my-plugin"
```

**npm** — for broader ecosystem reach:

```yaml
plugins:
  - src: "npm:dune-my-plugin"
```

**URL** — for quick sharing without a registry:

```yaml
plugins:
  - src: "https://raw.githubusercontent.com/you/plugin/main/mod.ts"
```

## Best practices

**Give your plugin a unique name.** The `name` field is also the config key in `config.plugins`. Use a scoped name (e.g. `@yourscope/plugin-name`) or a prefixed name (e.g. `dune-seo`) to avoid collisions.

**Provide sensible defaults.** Don't require users to configure every option. Every `configSchema` field should have a `default` that makes the plugin useful out of the box.

**Fail gracefully.** If your plugin can't do its job — missing config, network error, optional dependency not installed — log a warning and return early. Never crash the site.

**Document your hooks.** Tell users which lifecycle events your plugin listens to. The `dune plugin:list` command shows this automatically, but your `README.md` should explain *why* and the performance implications.

**Respect `stopPropagation`.** If a previous hook has already handled something, don't re-process it.

**Keep setup() fast.** `setup()` runs during server startup. Avoid slow I/O or network calls that would delay boot time. For expensive initialization, fire-and-forget with a logged warning if it fails.
