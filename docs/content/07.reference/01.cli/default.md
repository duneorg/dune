---
title: "CLI Commands"
published: true
visible: true
taxonomy:
  audience: [webmaster, developer]
  difficulty: [beginner]
  topic: [reference, cli]
metadata:
  description: "Complete reference for Dune CLI commands"
---

# CLI Commands

All commands are run with `dune` (or `deno task dune`).

## Development

| Command | Description |
|---------|-------------|
| `dune dev` | Start dev server with hot-reload. Watches content and themes for changes. |
| `dune serve` | Start production server. Uses pre-built content index. |
| `dune serve --port 3000` | Serve on a specific port. |

## Build & Cache

| Command | Description |
|---------|-------------|
| `dune build` | Build content index, validate config. Run before production serving. |
| `dune build --static` | Generate a fully static site into `dist/` (SSG). |
| `dune cache:clear` | Delete all cached data (rendered HTML, content index, images). |
| `dune cache:rebuild` | Rebuild content index from scratch. Use after bulk content changes. |

### Static build options (`dune build --static`)

| Option | Default | Description |
|--------|---------|-------------|
| `--out <dir>` | `dist` | Output directory |
| `--base-url <url>` | `config.site.url` | Canonical base URL for sitemap and feeds |
| `--no-incremental` | — | Rebuild all pages regardless of content changes |
| `--concurrency <n>` | `8` | Number of pages to render in parallel |
| `--hybrid` | — | Emit `_routes.json`, `_redirects`, `_headers` for edge deployments |
| `--include-drafts` | — | Include unpublished pages |
| `--verbose` | — | Print each rendered route |

See [Static Site Generation](/deployment/static) for full documentation.

## Configuration

| Command | Description |
|---------|-------------|
| `dune config:show` | Display the final merged config with source annotations showing where each value comes from. |
| `dune config:validate` | Validate all config files against schemas. Reports errors with suggestions. |

## Content

| Command | Description |
|---------|-------------|
| `dune content:list` | List all pages with their routes, templates, and publish status. |
| `dune content:check` | Validate all content: broken links, missing templates, orphaned media. |
| `dune content:i18n-status` | Report translation coverage across all configured languages. |

## Plugins

| Command | Description |
|---------|-------------|
| `dune plugin:list` | List all installed plugins with their registered hooks and config fields. |
| `dune plugin:install <src>` | Add a plugin to `config/site.yaml`. |
| `dune plugin:remove <src\|name>` | Remove a plugin from `config/site.yaml`. |
| `dune plugin:create [name]` | Scaffold a new plugin project at `plugins/{name}/`. |
| `dune plugin:publish [name]` | Publish a local plugin to JSR (runs `deno publish`). |
| `dune plugin:search <query>` | Search JSR for Dune-compatible plugins. |
| `dune plugin:update [name]` | Update a JSR or npm plugin to its latest version. Omit name to update all. |

## Scaffolding

| Command | Description |
|---------|-------------|
| `dune new [name]` | Create a new Dune site with starter content and default theme. |

## Config show example

```bash
$ dune config:show

site.title: "My Site"                    ← config/site.yaml:1
system.cache.enabled: false              ← config/env/development/system.yaml:3
system.cache.driver: "memory"            ← default
system.debug: true                       ← config/env/development/system.yaml:5
theme.name: "default"                    ← default
```

Each value shows exactly where it came from in the merge hierarchy.
