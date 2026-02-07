---
title: "Markdown Pages"
published: true
visible: true
taxonomy:
  audience: [editor, webmaster]
  difficulty: [beginner]
  topic: [content, markdown]
metadata:
  description: "Writing content pages in Markdown"
---

# Markdown Pages

Markdown is the default content format. Write prose in a natural syntax, and Dune renders it to HTML through your theme's templates.

## Anatomy of a Markdown page

```markdown
---
title: "My Page Title"
date: 2025-06-15
published: true
taxonomy:
  category: [tutorials]
  tag: [deno, getting-started]
metadata:
  description: "A page about something"
---

# My Page Title

Your content goes here. Write **bold**, *italic*, [links](https://example.com),
and everything else Markdown supports.

![An image](photo.jpg)
```

The file has two parts:

1. **Frontmatter** — YAML between `---` delimiters. Controls metadata, taxonomies, collections, and rendering.
2. **Body** — Markdown content below the frontmatter. Rendered to HTML at request time.

## Template selection

The filename of your `.md` file determines which theme template renders it:

| Filename | Template used | Typical use |
|----------|---------------|-------------|
| `default.md` | `templates/default.tsx` | General pages |
| `post.md` | `templates/post.tsx` | Blog posts |
| `blog.md` | `templates/blog.tsx` | Blog listing |
| `item.md` | `templates/item.tsx` | Portfolio items |

You can override this with the `template` frontmatter field:

```yaml
---
title: "Special Page"
template: landing
---
```

This page will render with `templates/landing.tsx` regardless of its filename.

## Images and media

Media files live next to your content file. Reference them with plain relative paths:

```markdown
![Cover photo](cover.jpg)
![Diagram](diagrams/architecture.png)
```

Dune resolves these to the correct URLs automatically. The image doesn't need to be uploaded anywhere — it's right there in the folder.

### Media metadata

Add a sidecar YAML file to attach metadata to any media file:

`cover.jpg.meta.yaml`:
```yaml
alt: "A sunset over the mountains"
credit: "Photo by Jane Doe"
title: "Mountain Sunset"
```

## Markdown features

Dune uses a standard Markdown parser. All standard syntax is supported:

- **Headings** (`# H1` through `###### H6`)
- **Emphasis** (`**bold**`, `*italic*`, `~~strikethrough~~`)
- **Links** (`[text](url)`)
- **Images** (`![alt](path)`)
- **Code blocks** (fenced with triple backticks, with language hints)
- **Lists** (ordered and unordered)
- **Blockquotes** (`> quote`)
- **Tables** (pipe syntax)
- **Horizontal rules** (`---`)

## Publishing control

Control whether a page is visible and accessible:

```yaml
---
title: "Draft Post"
published: false        # Not served, not in collections
visible: false          # Served, but hidden from navigation
routable: false         # Not accessible by URL (modular content)
---
```

| Field | Default | Effect |
|-------|---------|--------|
| `published` | `true` | If `false`, page doesn't exist for visitors |
| `visible` | `true` | If `false`, page is accessible but hidden from nav menus |
| `routable` | `true` | If `false`, page has no URL (used for modular sections) |
