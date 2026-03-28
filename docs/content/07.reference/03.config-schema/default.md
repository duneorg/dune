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
home: null                       # string | null — Home page slug. Auto-detected if null.
cors_origins: []                 # string[] — Extra origins allowed for cross-origin API requests

feed:
  enabled: true                  # boolean — Generate /feed.xml and /atom.xml (default: true)
  items: 20                      # number  — Most-recent dated pages to include (default: 20)
  content: "summary"             # "summary" | "full" — Feed item body (default: "summary")

sitemap:
  exclude: []                    # string[] — Route prefixes to omit from /sitemap.xml
  changefreq: {}                 # Record<string, changefreq> — Per-route overrides (longest prefix wins)
  # Valid changefreq values: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never"
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

typography:
  orphan_protection: true        # boolean — Insert &nbsp; before last word in paragraphs

search:
  customFields: []               # string[] — Extra frontmatter field names to include in search index
                                 #   e.g. ["summary", "author", "series"]

debug: false                     # boolean
timezone: "UTC"                  # string — IANA timezone
```

## admin.yaml (or admin: block in dune.config.ts)

```yaml
admin:
  enabled: true                  # boolean — Enable admin panel (default: true)
  path: "/admin"                 # string — URL prefix for the admin panel
  sessionLifetime: 86400         # number — Session lifetime in seconds (default: 86400 = 24 h)
  dataDir: "data"                # string — Persistent data directory (users, submissions, comments). Git-tracked.
  runtimeDir: ".dune/admin"      # string — Runtime data directory (sessions, revisions, staging, analytics). Not git-tracked.
  maxRevisions: 50               # number — Maximum revisions retained per page (default: 50)
  git_commit: false              # boolean — Auto-commit to git after every page save/publish (default: false)

  # Outbound webhooks — fired on content mutation events
  webhooks:
    - url: "https://hooks.example.com/content"
      secret: "$WEBHOOK_SECRET"   # string — HMAC-SHA256 signing secret ("$ENV_VAR" expansion supported)
      label: "My integration"     # string — Human-readable label for delivery logs (optional)
      enabled: true               # boolean — Disable without removing (default: true)
      events:                     # WebhookContentEvent[] — which events trigger this endpoint
        - onPageCreate
        - onPageUpdate
        - onPageDelete
        - onWorkflowChange

  # Incoming webhooks — let external systems trigger actions via POST /api/webhook/incoming
  incoming_webhooks:
    - token: "$DEPLOY_WEBHOOK_TOKEN"   # string — pre-shared token ("$ENV_VAR" expansion supported)
      actions: [rebuild]               # Array<"rebuild" | "purge-cache">
    - token: "$CACHE_WEBHOOK_TOKEN"
      actions: [purge-cache]
```

Valid `events` values: `onPageCreate`, `onPageUpdate`, `onPageDelete`, `onWorkflowChange`. See [Webhooks](/webhooks) for full documentation.

Valid incoming webhook `actions`: `rebuild` (re-indexes content), `purge-cache` (clears the processed image cache).

`dataDir` contains user accounts, form submissions, and editorial comments — should be committed to version control. `runtimeDir` contains ephemeral session, revision, staging, and analytics data — should be in `.gitignore`.

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
