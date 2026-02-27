---
title: "System Configuration"
published: true
visible: true
taxonomy:
  audience: [webmaster, developer]
  difficulty: [intermediate]
  topic: [configuration]
metadata:
  description: "Engine behavior configuration: cache, content, images, languages"
---

# System Configuration

`config/system.yaml` controls how the Dune engine behaves — caching, content parsing, image handling, and more.

## Full reference

```yaml
# Content settings
content:
  dir: "content"                  # content directory (relative to site root)
  markdown:
    extra: true                   # extended markdown features
    auto_links: true              # auto-link URLs in text
    auto_url_links: true          # auto-link bare URLs

# Cache settings
cache:
  enabled: true
  driver: "filesystem"            # "memory", "filesystem", or "kv"
  lifetime: 3600                  # seconds
  check: "file"                   # "file" (mtime), "hash", or "none"

# Image processing
images:
  default_quality: 80             # JPEG/WebP quality (1-100)
  cache_dir: ".dune/cache/images"
  allowed_sizes: [320, 640, 768, 1024, 1280, 1536, 1920]   # prevent resize attacks

# Language support
languages:
  supported: ["en"]
  default: "en"
  include_default_in_url: false   # if true: /en/page, if false: /page

# Typography
typography:
  orphan_protection: true         # prevent single-word last lines in paragraphs

# Debug mode
debug: false

# Timezone
timezone: "UTC"
```

## Cache drivers

| Driver | Storage | Best for |
|--------|---------|----------|
| `filesystem` | `.dune/cache/` directory | Local development, traditional servers |
| `memory` | In-process memory | Development, small sites |
| `kv` | Deno KV store | Deno Deploy, edge deployment |

## Cache invalidation

The `check` field determines how Dune detects stale content:

| Strategy | How it works | Trade-off |
|----------|-------------|-----------|
| `file` | Compare file modification time | Fast, misses renames |
| `hash` | Hash file content | Accurate, slightly slower |
| `none` | Never invalidate | Fastest, manual rebuild needed |

## Environment-specific overrides

Development and production often need different settings. Put overrides in `config/env/{name}/`:

`config/env/development/system.yaml`:
```yaml
debug: true
cache:
  enabled: false
```

`config/env/production/system.yaml`:
```yaml
debug: false
cache:
  enabled: true
  driver: "kv"
  check: "hash"
```

### Environment detection

Dune detects the current environment in this order:

1. `DUNE_ENV` environment variable (explicit)
2. `DENO_DEPLOYMENT_ID` exists → `"production"` (Deno Deploy auto-detection)
3. Default: `"development"`

Set `DUNE_ENV` in your deploy script:

```bash
DUNE_ENV=production dune serve
```

## Typography

### `orphan_protection`

Default: `true`

When enabled, Dune inserts a non-breaking space (`&nbsp;`) before the last word of every rendered paragraph. This prevents typographic orphans — single words stranded alone on the last line.

Disable if you're post-processing HTML output yourself or if your theme handles orphan prevention:

```yaml
typography:
  orphan_protection: false
```
