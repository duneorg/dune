---
title: "Project Structure"
published: true
visible: true
taxonomy:
  audience: [webmaster, developer]
  difficulty: [beginner]
  topic: [architecture]
metadata:
  description: "Understanding the Dune project directory structure"
---

# Project Structure

A Dune site has a predictable structure. Every directory has a clear purpose.

```
my-site/
├── dune.config.ts            # Programmatic config (TypeScript)
├── content/                  # All content lives here
│   ├── 01.home/
│   │   └── default.md
│   ├── 02.blog/
│   │   ├── blog.md
│   │   └── 01.hello-world/
│   │       ├── post.md
│   │       └── cover.jpg
│   ├── 03.about/
│   │   └── default.md
│   └── 04.landing/
│       └── page.tsx          # TSX content page
├── config/
│   ├── site.yaml             # Site identity and metadata
│   ├── system.yaml           # Engine behavior
│   └── env/
│       ├── development/
│       │   └── system.yaml   # Dev-specific overrides
│       └── production/
│           └── system.yaml   # Production overrides
├── themes/
│   └── my-theme/
│       ├── theme.yaml        # Theme manifest
│       ├── templates/        # JSX/TSX page templates
│       │   ├── default.tsx
│       │   ├── post.tsx
│       │   └── blog.tsx
│       ├── components/       # Shared layout components
│       │   └── layout.tsx
│       └── static/           # Theme assets (CSS, fonts)
│           └── styles.css
├── plugins/                  # Local plugins
└── static/                   # Global static files (favicon, robots.txt)
```

## Content directory conventions

| Pattern | Meaning | URL |
|---------|---------|-----|
| `01.name/` | Ordered, visible in navigation | `/name` (number stripped) |
| `name/` | Unordered, hidden from auto-navigation | `/name` |
| `_name/` | Modular section, non-routable | Not accessible by URL |
| `_drafts/` | Draft container | Nothing inside is accessible |

## Config hierarchy

Configuration merges from general to specific. Each layer overrides the previous:

1. **System defaults** — hardcoded in Dune
2. **`config/system.yaml` + `config/site.yaml`** — your site config
3. **`config/env/{environment}/`** — environment overrides
4. **`dune.config.ts`** — programmatic overrides
5. **Page frontmatter** — per-page overrides

## Content formats

Dune supports multiple content formats in the same site:

| Format | Best for | Template |
|--------|----------|----------|
| `.md` | Blog posts, docs, simple pages | Theme template by filename |
| `.tsx` | Landing pages, interactive content | Self-rendering (component IS content) |
| `.mdx` | Tutorials with live examples | Theme template by filename *(v0.2)* |

You can freely mix formats. A blog section might have Markdown posts alongside a TSX landing page. They share the same folder conventions, frontmatter system, collections, and taxonomies.
