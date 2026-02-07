---
title: "Themes"
published: true
visible: true
taxonomy:
  audience: [webmaster, developer]
  difficulty: [intermediate]
  topic: [themes]
metadata:
  description: "Using and creating Dune themes"
collection:
  items:
    "@self.children": true
  order:
    by: order
    dir: asc
---

# Themes

Themes control how your content looks. They're collections of JSX/TSX templates, components, and static assets.

## Theme structure

```
themes/
└── my-theme/
    ├── theme.yaml            # Theme manifest
    ├── templates/            # Page templates (one per content type)
    │   ├── default.tsx       # default.md → this template
    │   ├── post.tsx          # post.md → this template
    │   ├── blog.tsx          # blog.md → this template
    │   └── error.tsx         # 404 and error pages
    ├── components/           # Shared components
    │   ├── layout.tsx        # Base layout wrapper
    │   ├── header.tsx
    │   ├── footer.tsx
    │   └── nav.tsx
    ├── islands/              # Interactive client components (Fresh islands)
    │   ├── search.tsx
    │   └── mobile-nav.tsx
    └── static/               # Theme assets
        ├── styles.css
        └── fonts/
```

## The theme manifest

`theme.yaml`:
```yaml
name: my-theme
version: 1.0.0
description: "A clean documentation theme"
author: "Your Name"
parent: default             # optional: inherit from another theme
```

## Using a theme

Set the active theme in `config/site.yaml` (via the `theme` config section) or in `dune.config.ts`:

```yaml
# In your site's config, the theme section controls which theme is active
```

Or programmatically in `dune.config.ts`:

```typescript
export default {
  theme: {
    name: "my-theme",
    custom: {
      primaryColor: "#1a1a2e",
      showSidebar: true,
    },
  },
};
```
