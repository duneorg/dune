---
title: "Collections"
published: true
visible: true
taxonomy:
  audience: [editor, webmaster, developer]
  difficulty: [intermediate]
  topic: [content, collections]
metadata:
  description: "Declarative content queries with collections"
---

# Collections

Collections are Dune's way of gathering and displaying groups of pages. They're defined in frontmatter — no code, no database queries, no GraphQL.

## Basic example: blog listing

```yaml
---
title: "Blog"
collection:
  items:
    "@self.children": true
  order:
    by: date
    dir: desc
---
```

This gathers all child pages of the current page, sorted by date (newest first). The theme's `blog.tsx` template receives these pages and renders the listing.

## Collection sources

The `items` field determines WHERE to pull pages from:

### Self-relative sources

| Source | Description |
|--------|-------------|
| `@self.children` | Direct children of this page |
| `@self.siblings` | Pages at the same level |
| `@self.modules` | Modular sections (`_name/` children) |
| `@self.descendants` | All nested pages at any depth |

### Path-based sources

| Source | Description |
|--------|-------------|
| `@page.children: "/blog"` | Children of a specific page |
| `@page.descendants: "/docs"` | All descendants of a specific page |

### Taxonomy-based sources

| Source | Description |
|--------|-------------|
| `@taxonomy.tag: "deno"` | All pages tagged "deno" |
| `@taxonomy.category: ["tutorials", "guides"]` | Pages in either category |
| `@taxonomy: { tag: "deno", category: "tutorials" }` | Pages matching ALL criteria |

## Ordering

```yaml
collection:
  items:
    "@self.children": true
  order:
    by: date       # "date", "title", "order", "random", or "custom.field"
    dir: desc      # "asc" or "desc"
```

| Order by | Sorts on |
|----------|----------|
| `date` | Frontmatter `date` field |
| `title` | Frontmatter `title` (alphabetical) |
| `order` | Folder numeric prefix (`01.`, `02.`, ...) |
| `random` | Randomized on each request |
| `custom.fieldname` | Any field in frontmatter `custom` |

## Filtering

Narrow results with filters:

```yaml
collection:
  items:
    "@self.descendants": true
  filter:
    published: true
    template: post
    taxonomy:
      tag: deno
```

| Filter | Effect |
|--------|--------|
| `published: true` | Only published pages (default behavior) |
| `visible: true` | Only visible pages |
| `routable: true` | Only routable pages |
| `template: "post"` | Only pages using the `post` template |
| `template: ["post", "article"]` | Pages using either template |
| `taxonomy: { tag: "deno" }` | Pages with specific taxonomy values |

## Pagination

```yaml
collection:
  items:
    "@self.children": true
  order:
    by: date
    dir: desc
  pagination:
    size: 10
```

With pagination enabled, the collection provides page navigation data:

- `collection.page` — current page number
- `collection.pages` — total number of pages
- `collection.hasNext` / `collection.hasPrev` — navigation booleans

The URL automatically gains a `/page:2`, `/page:3` suffix.

## Limit and offset

For simple truncation without full pagination:

```yaml
collection:
  items:
    "@self.children": true
  order:
    by: date
    dir: desc
  limit: 5         # show only 5 items
  offset: 0        # skip N items from the start
```

## Combining everything

A real-world example — a "Related posts" section:

```yaml
---
title: "Advanced Deno Patterns"
taxonomy:
  tag: [deno, patterns, advanced]
  category: [tutorials]
collection:
  items:
    "@taxonomy.tag": "deno"
  filter:
    published: true
    template: post
  order:
    by: date
    dir: desc
  limit: 5
---
```

This pulls up to 5 published blog posts tagged "deno", sorted newest first. The current page is automatically excluded from its own collection results.
