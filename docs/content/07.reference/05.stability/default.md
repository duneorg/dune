---
title: "API Stability"
published: true
visible: true
taxonomy:
  audience: [developer]
  difficulty: [intermediate]
  topic: [api, plugins, stability]
metadata:
  description: "Dune's versioning policy, stability guarantees, and what changes between major, minor, and patch releases"
---

# API Stability

Dune follows [Semantic Versioning](https://semver.org). This page describes what is stable, what can change, and how to write forward-compatible code.

## Version policy

Dune is currently pre-1.0. Per semver convention, minor versions may include breaking changes until v1.0.0.

| Version bump | Meaning |
|---|---|
| **Patch** (0.6.x) | Bug fixes. No API changes. Safe to apply immediately. |
| **Minor** (0.7.0+) | New features. May include breaking changes (pre-1.0 convention). Check the changelog before upgrading. |
| **1.0.0** | First stable release. From here: minor = backwards-compatible, major = breaking. |

## Stable APIs

Everything exported from `@dune/core` is the public API as of v0.6.0.

```ts
import {
  createDuneEngine,
  type DuneEngine,
  type Page,
  type PageFrontmatter,
  type DunePlugin,
  type HookEvent,
  sectionRegistry,
  renderSections,
} from "@dune/core";
```

The following sub-module exports are also available:

| Import path | Contents |
|---|---|
| `@dune/core/plugins` | `PLUGIN_API_VERSION`, `loadPlugins`, `loadPluginAdminConfigs` |
| `@dune/core/sections` | `SectionRegistry`, `sectionRegistry`, `renderSections`, section types |

## Internal APIs

Anything **not** exported from `@dune/core` (or its sub-modules) is internal and may change at any time:

- Deep imports like `import { … } from "@dune/core/src/admin/server.ts"` are unsupported.
- The file and folder structure of `src/` is not part of the public API.
- Admin HTML templates and CSS class names are not stable.

## Plugin API

The plugin interface is frozen since v0.6.0. No field will be removed from `DunePlugin` before v1.0.

```ts
import type { DunePlugin } from "@dune/core";

const plugin: DunePlugin = {
  name: "my-plugin",
  version: "1.0.0",
  description: "Does something useful",
  hooks: {
    onPageLoaded: async ({ data, config }) => {
      // data is the Page that was just loaded
    },
    onAfterRender: async ({ data, setData }) => {
      // data is the rendered HTML string; setData() replaces it
      setData(data.replace("</body>", "<script>…</script></body>"));
    },
  },
  setup: async (api) => {
    // api.hooks, api.config, api.storage
  },
};

export default plugin;
```

### Plugin API version

Check `PLUGIN_API_VERSION` at runtime if your plugin uses features that were added in a specific version:

```ts
import { PLUGIN_API_VERSION } from "@dune/core/plugins";

if (PLUGIN_API_VERSION !== "0.6") {
  console.warn(`[my-plugin] expected plugin API 0.6, got ${PLUGIN_API_VERSION}`);
}
```

Use a `!==` check only if you need an exact version; prefer a `<` or `>` comparison when checking for minimum capability.

### Hook events

All hook events as of v0.6.0:

| Category | Event | Data type |
|---|---|---|
| Startup | `onConfigLoaded` | `DuneConfig` |
| Startup | `onStorageReady` | `StorageAdapter` |
| Startup | `onContentIndexReady` | `PageIndex[]` |
| Request | `onRequest` | `Request` |
| Request | `onRouteResolved` | `RouteMatch` |
| Request | `onPageLoaded` | `Page` |
| Request | `onCollectionResolved` | `Collection` |
| Request | `onBeforeRender` | `TemplateProps` |
| Request | `onAfterRender` | `string` (HTML) |
| Request | `onResponse` | `Response` |
| Content | `onMarkdownProcess` | `string` (raw markdown) |
| Content | `onMarkdownProcessed` | `string` (HTML) |
| Content | `onMediaDiscovered` | `MediaFile` |
| Cache | `onCacheHit` | `string` (route) |
| Cache | `onCacheMiss` | `string` (route) |
| Cache | `onCacheInvalidate` | `string` (route) |
| API | `onApiRequest` | `Request` |
| API | `onApiResponse` | `Response` |
| Engine | `onRebuild` | `void` |
| Engine | `onThemeSwitch` | `string` (theme name) |
| Admin CRUD | `onPageCreate` | `PageIndex` |
| Admin CRUD | `onPageUpdate` | `PageIndex` |
| Admin CRUD | `onPageDelete` | `string` (sourcePath) |
| Admin CRUD | `onWorkflowChange` | `{ sourcePath, status }` |

New events will be added in minor versions. Exhaustive `switch`/`if` chains over `HookEvent` values should have a fallthrough case.

## Section registry

The `SectionRegistry` and `sectionRegistry` singleton are stable. Register custom section types from your plugin's `setup()` function:

```ts
import { sectionRegistry } from "@dune/core/sections";
import type { DunePlugin } from "@dune/core";

const plugin: DunePlugin = {
  name: "my-sections",
  version: "1.0.0",
  hooks: {},
  setup: () => {
    sectionRegistry.register({
      type: "announcement",
      label: "Announcement",
      icon: "📢",
      description: "Full-width announcement strip",
      fields: [
        { id: "message", type: "text", label: "Message", required: true },
        {
          id: "color",
          type: "select",
          label: "Color",
          default: "blue",
          options: [
            { value: "blue", label: "Blue" },
            { value: "red", label: "Red" },
          ],
        },
      ],
    });
  },
};
```

Custom sections appear in the Visual Page Builder palette immediately.

## Type stability

Core types frozen since v0.6.0 — no fields will be removed before v1.0:

| Type | Stable since |
|---|---|
| `DunePlugin` | 0.1.0 |
| `HookEvent` | 0.1.0 |
| `HookContext` | 0.1.0 |
| `PluginApi` | 0.1.0 |
| `Page` | 0.1.0 |
| `PageIndex` | 0.1.0 |
| `PageFrontmatter` | 0.1.0 |
| `TemplateProps` | 0.1.0 |
| `DuneConfig` / `SiteConfig` | 0.1.0 |
| `StorageAdapter` | 0.1.0 |
| `SectionDef` | 0.6.0 |
| `SectionInstance` | 0.6.0 |

New **optional** fields may be added to these types in minor versions. Code that spreads or destructures these types should use rest parameters to remain forward-compatible:

```ts
// ✅ forward-compatible
const { title, date, ...rest } = page.frontmatter;

// ⚠️ may fail if a new required property is added
const fm: PageFrontmatter = { title: "…" };
```

## Config schema stability

Fields in `site.yaml` and `system.yaml` that are documented in [Config Schema](/reference/config-schema) are stable. New optional keys may be added in minor versions. Keys will not be removed before v1.0.

## What is NOT stable

- Admin HTML, CSS, and JavaScript — may change in any release.
- `deno.lock` — updated as dependencies are upgraded.
- Internal file structure under `src/` — import only from `@dune/core`.
- The admin URL structure (`/admin/*`) — may change in minor versions.
- CLI output format — do not parse `dune content:list` output programmatically; use the engine API instead.
