---
title: "Configuration"
published: true
visible: true
taxonomy:
  audience: [webmaster, developer]
  difficulty: [beginner]
  topic: [configuration]
metadata:
  description: "Configuring Dune: YAML files, environment overrides, and programmatic config"
collection:
  items:
    "@self.children": true
  order:
    by: order
    dir: asc
---

# Configuration

Dune's configuration is layered: simple YAML files for most needs, TypeScript for advanced cases, and environment-specific overrides for deployment.

## Config files

```
config/
├── site.yaml               # Site identity: title, URL, taxonomies
├── system.yaml             # Engine behavior: cache, debug, languages
└── env/
    ├── development/
    │   └── system.yaml     # Dev overrides (debug: true, etc.)
    └── production/
        └── system.yaml     # Production overrides
```

## Merge order

Configuration merges from general to specific. Each layer overrides the previous:

```
1. System defaults (hardcoded in Dune)
    ↓ merged with
2. config/system.yaml + config/site.yaml
    ↓ merged with
3. config/env/{DUNE_ENV}/*.yaml
    ↓ merged with
4. dune.config.ts (programmatic)
    ↓ merged with
5. Page frontmatter (per-page)
```

You only need to set what you want to change. Everything else uses sensible defaults.
