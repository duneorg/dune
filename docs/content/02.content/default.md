---
title: "Content"
published: true
visible: true
taxonomy:
  audience: [editor, webmaster, developer]
  difficulty: [beginner]
  topic: [content]
metadata:
  description: "Understanding Dune's content model: folders, formats, and frontmatter"
collection:
  items:
    "@self.children": true
  order:
    by: order
    dir: asc
---

# Content Model

In Dune, content is files. There is no database. Every page is a folder containing a content file and its associated media.

```
content/
├── 01.home/
│   └── default.md          ← a page
├── 02.blog/
│   ├── blog.md             ← a listing page
│   └── 01.hello-world/
│       ├── post.md         ← a child page
│       └── cover.jpg       ← co-located media
└── 03.landing/
    └── page.tsx            ← a TSX content page
```

## Core ideas

**Folder = page.** A folder in `content/` represents a page. The content file inside determines what it shows and how it renders.

**Filename = template.** `post.md` renders with the `post.tsx` theme template. `default.md` uses `default.tsx`. This is convention over configuration.

**Frontmatter = metadata.** The YAML block at the top of each file controls title, date, taxonomies, collections, visibility, caching, and more.

**Formats are interchangeable.** Markdown for prose. TSX for interactive pages. They share the same folder conventions, frontmatter fields, collection system, and taxonomy system.

## Content formats at a glance

| Format | Frontmatter | Body | Rendering | Best for |
|--------|-------------|------|-----------|----------|
| `.md` | YAML between `---` | Markdown → HTML | Injected into theme template | Blog posts, docs, articles |
| `.tsx` | `export const frontmatter = {}` or sidecar YAML | JSX component | Self-rendering, optional layout | Landing pages, interactive content |
| `.mdx` | YAML between `---` | Markdown + JSX | Compiled, injected into template | Tutorials with live examples *(v0.2)* |

Read on for details on each format, frontmatter fields, media handling, collections, and taxonomies.
