---
title: "Frontmatter Reference"
published: true
visible: true
taxonomy:
  audience: [editor, webmaster, developer]
  difficulty: [beginner]
  topic: [content, reference]
metadata:
  description: "Complete reference for all frontmatter fields"
---

# Frontmatter

Frontmatter is the YAML block at the top of every content file. It controls how a page behaves, where it appears, and how it's rendered.

## All fields

### Identity

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `title` | string | `""` | Page title (required for meaningful pages) |
| `descriptor` | string | — | Short subtitle shown after title in browser tab |
| `slug` | string | folder name | Override the URL slug |
| `template` | string | filename | Override template selection (`.md` only) |
| `layout` | string \| false | `"default"` | Layout wrapping (`.tsx` only) |

The `descriptor` field controls the page title shown in the browser tab. When present, the title format is **"Title - Descriptor | Site Name"**. Without it, the format is **"Title | Site Name"**.

```yaml
title: "Services"
descriptor: "Custom Web Solutions"
# → browser tab: "Services - Custom Web Solutions | My Site"
```

### Publishing

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `published` | boolean | `true` | If `false`, page doesn't exist for visitors |
| `status` | string | — | Workflow status: `draft`, `in_review`, `published`, `archived` |
| `date` | string | — | Publication date (ISO 8601) |
| `publish_date` | string | — | Scheduled publish (ISO 8601 datetime) |
| `unpublish_date` | string | — | Scheduled unpublish (ISO 8601 datetime) |
| `visible` | boolean | `true` | If `false`, accessible but hidden from navigation |
| `routable` | boolean | `true` | If `false`, page has no URL (modular sections) |

The `status` field is used by the content workflow system for editorial management. It works independently of `published` — a page with `status: draft` and `published: true` is still accessible. Use `published: false` to actually hide a page from visitors.

### Taxonomy

```yaml
taxonomy:
  category: [tutorials, guides]
  tag: [deno, fresh, cms]
  author: [jane]
```

Taxonomies are defined in `config/site.yaml` under `taxonomies`. Any taxonomy listed there can be used in frontmatter. Values are always arrays.

### Metadata

```yaml
metadata:
  description: "Page description for SEO"
  og:image: cover.jpg
  robots: "noindex"
```

Key-value pairs for HTML `<meta>` tags and SEO. Values are strings.

### Routes

```yaml
routes:
  aliases:
    - /old-path
    - /another-old-path
  canonical: /the-real-url
```

`aliases` create additional URLs that serve this page. `canonical` sets the preferred URL for search engines.

### Summary

```yaml
summary:
  size: 300          # characters
  format: short      # "short" or "long"
```

Controls automatic excerpt generation from the page body.

### Cache

```yaml
cache:
  enable: true
  lifetime: 3600     # seconds
```

Per-page cache overrides. Takes precedence over system-level cache settings.

### Collection

```yaml
collection:
  items:
    "@self.children": true
  order:
    by: date
    dir: desc
  filter:
    published: true
  limit: 10
  pagination:
    size: 10
```

Declarative content queries. See the [Collections](../04.collections) page for full details.

### Custom data

```yaml
custom:
  featured: true
  rating: 5
  hero_color: "#1a1a2e"
```

Arbitrary structured data accessible in templates. Use this for any page-specific data that doesn't fit the standard fields.

## Minimal frontmatter

The only truly required field is `title`. Everything else has sensible defaults:

```yaml
---
title: "My Page"
---
```

This creates a published, visible, routable page with no taxonomies, default caching, and template selection by filename.
