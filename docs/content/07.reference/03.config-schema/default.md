---
title: "Configuration Schema"
published: true
visible: true
taxonomy:
  audience: [webmaster, developer]
  difficulty: [intermediate]
  topic: [reference, configuration]
metadata:
  description: "Complete configuration schema reference for site.yaml and system.yaml"
---

# Configuration Schema

## site.yaml

```yaml
# REQUIRED
title: string                    # Site title

# OPTIONAL (with defaults)
description: ""                  # string — Site description
url: "http://localhost:8000"     # string — Canonical base URL

author:
  name: ""                       # string — Author name
  email: ""                      # string — Author email (optional)

metadata: {}                     # Record<string, string> — HTML meta tags

taxonomies:                      # string[] — Enabled taxonomy types
  - "category"
  - "tag"

routes: {}                       # Record<string, string> — Route aliases
redirects: {}                    # Record<string, string> — 301 redirects
```

## system.yaml

```yaml
content:
  dir: "content"                 # string — Content directory path
  markdown:
    extra: true                  # boolean — Extended markdown features
    auto_links: true             # boolean — Auto-link URLs
    auto_url_links: true         # boolean — Auto-link bare URLs

cache:
  enabled: true                  # boolean
  driver: "filesystem"           # "memory" | "filesystem" | "kv"
  lifetime: 3600                 # number — Seconds
  check: "file"                  # "file" | "hash" | "none"

images:
  default_quality: 80            # number — 1-100
  cache_dir: ".dune/cache/images"  # string
  allowed_sizes:                 # number[] — widths/heights allowed for on-the-fly processing
    - 320
    - 640
    - 768
    - 1024
    - 1280
    - 1536
    - 1920

languages:
  supported: ["en"]              # string[] — Language codes
  default: "en"                  # string — Must be in supported list
  include_default_in_url: false  # boolean — /en/page vs /page

debug: false                     # boolean
timezone: "UTC"                  # string — IANA timezone
```

## admin.yaml (or admin: block in dune.config.ts)

```yaml
admin:
  enabled: true                  # boolean — Enable admin panel (default: true)
  path: "/admin"                 # string — URL prefix for the admin panel
  sessionLifetime: 86400         # number — Session lifetime in seconds (default: 86400 = 24 h)
  dataDir: "data"                # string — Persistent data directory (users, submissions). Git-tracked.
  runtimeDir: ".dune/admin"      # string — Runtime data directory (sessions, locks). Not git-tracked.
```

`dataDir` contains user accounts and form submissions and should be committed to version control. `runtimeDir` contains ephemeral session data and should be in `.gitignore`.

## theme config

Set in `dune.config.ts` or via config:

```yaml
theme:
  name: "default"                # string — Active theme name
  parent: null                   # string | null — Parent theme for inheritance
  custom: {}                     # Record<string, unknown> — Theme-specific settings
```

## plugins config

```yaml
plugins:
  plugin-name:                   # Plugin-specific config (arbitrary keys)
    key: value
```

## Validation

Run `dune config:validate` to check your config files. The validator produces actionable error messages:

```
✗ Config error in config/site.yaml:
  → site.taxonomies must be an array of strings
  → Got: "category, tag" (string)
  → Did you mean: ["category", "tag"]?
```
