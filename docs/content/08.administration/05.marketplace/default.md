---
title: "Marketplace"
published: true
visible: true
taxonomy:
  audience: [developer, admin]
  difficulty: [beginner]
  topic: [plugins, themes, marketplace]
metadata:
  description: "Discover and install plugins and themes from the Dune Marketplace"
---

# Marketplace

The Marketplace is the built-in discovery and installation hub for Dune plugins and themes. Access it at **Admin → Marketplace**.

## Overview

The Marketplace has two tabs:

| Tab | Contents |
|---|---|
| **Plugins** | Extensions that add new functionality via hooks |
| **Themes** | Visual templates that control your site's appearance |

Both tabs show download counts, verified publisher badges, and compatibility information.

## Plugins

### Browsing plugins

Each plugin card shows:

- **Name and package** — the display name and JSR package identifier
- **Verified badge** — plugins published by the Dune Team or verified community publishers
- **Description** — what the plugin does
- **Tags** — searchable categories
- **Hooks** — the lifecycle events the plugin subscribes to
- **Download count** — total installs across all Dune sites
- **Source link** — link to the plugin's repository
- **Compatibility** — required Dune version range

### Installing a plugin

1. Click **Install** on a plugin card.
2. Dune adds the plugin entry to `config/site.yaml` under the `plugins:` key.
3. Restart the Dune server for the plugin to be loaded and activated.

The install adds a minimal entry:

```yaml
plugins:
  - src: "jsr:@dune/plugin-analytics@^1.0.0"
```

After the restart, configure the plugin at **Admin → Plugins** if it exposes settings.

### After installing

- The Install button changes to **Installed ✓** — clicking again is a no-op.
- Configure plugin settings at **Admin → Plugins → [plugin name] → Configure**.
- To uninstall, remove the entry from `config/site.yaml` and restart.

## Themes

### Browsing themes

Each theme card shows:

- **Screenshot** — visual preview of the theme
- **Verified badge** — themes published by the Dune Team or verified publishers
- **Author and license**
- **Download count**
- **Tags** — e.g. `blog`, `docs`, `portfolio`
- **Demo link** — live preview of the theme
- **Compatibility** — required Dune version range

### Installing a theme

1. Click **Demo ↗** to preview the theme in your browser (optional).
2. Click **Install** on the theme card.
3. Dune downloads the theme ZIP and extracts it into the `themes/` directory.
4. Switch to the theme at **Admin → Config → Theme** or in `config/site.yaml`:

```yaml
theme:
  name: "docs"
```

No restart is required — theme switches take effect immediately.

## Verified publisher badge

The **✓ Verified** badge means the plugin or theme has been:

- Reviewed by the Dune Team for security and code quality
- Published from a verified publisher account
- Tested against the stated `compatibleWith` version range

Community entries without the badge may still work correctly but have not been formally reviewed.

## Registry API

The bundled registry JSON is accessible without authentication at:

| Endpoint | Description |
|---|---|
| `GET /admin/api/registry/plugins` | Full plugin registry |
| `GET /admin/api/registry/themes` | Full theme registry |

These endpoints return the same JSON files bundled with Dune. The registry is updated with each Dune release.

## Publishing to the Marketplace

To list a plugin or theme in the official Marketplace:

1. Publish your plugin to [JSR](https://jsr.io) (`dune plugin:publish`) or host a theme ZIP on GitHub Releases.
2. Open a pull request against the [dune-cms/registry](https://github.com/dune-cms/registry) repository adding your entry.
3. The Dune Team will review and, if approved, include it in the next registry update.

See the [Plugin Development](/reference/plugin-api) and [Theme Development](/themes/creating-themes) guides for packaging requirements.
