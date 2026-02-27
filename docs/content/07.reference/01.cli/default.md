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
| `dune build` | Build content index, validate config, optimize assets. Run before production serving. |
| `dune cache:clear` | Delete all cached data (rendered HTML, content index, images). |
| `dune cache:rebuild` | Rebuild content index from scratch. Use after bulk content changes. |

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
