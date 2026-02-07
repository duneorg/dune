---
title: "REST API"
published: true
visible: true
taxonomy:
  audience: [developer]
  difficulty: [intermediate]
  topic: [reference, api]
metadata:
  description: "Dune REST API endpoints reference"
---

# REST API

Every content operation is available via REST. All responses are JSON.

## Pages

### List all pages

```
GET /api/pages
```

Query parameters:

| Param | Type | Description |
|-------|------|-------------|
| `limit` | number | Maximum pages to return |
| `offset` | number | Skip N pages |
| `template` | string | Filter by template name |
| `published` | boolean | Filter by publish status |
| `order` | string | Sort field: `date`, `title`, `order` |
| `dir` | string | Sort direction: `asc`, `desc` |

Response:
```json
{
  "items": [
    {
      "route": "/blog/hello-world",
      "title": "Hello World",
      "date": "2025-06-15",
      "template": "post",
      "format": "md",
      "published": true,
      "taxonomy": {
        "tag": ["deno", "fresh"],
        "category": ["tutorials"]
      }
    }
  ],
  "total": 42,
  "limit": 20,
  "offset": 0
}
```

### Get a single page

```
GET /api/pages/{route}
```

Returns the full page object including rendered HTML content.

```json
{
  "route": "/blog/hello-world",
  "title": "Hello World",
  "date": "2025-06-15",
  "template": "post",
  "format": "md",
  "html": "<h1>Hello World</h1><p>This is my first post...</p>",
  "frontmatter": { ... },
  "media": [
    { "name": "cover.jpg", "url": "/content-media/02.blog/01.hello-world/cover.jpg", "type": "image/jpeg" }
  ]
}
```

### Get child pages

```
GET /api/pages/{route}/children
```

Returns direct child pages of the given page.

```json
{
  "items": [
    {
      "route": "/blog/hello-world",
      "title": "Hello World",
      "date": "2025-06-15",
      "template": "post",
      "format": "md",
      "order": 1
    }
  ],
  "total": 3
}
```

### Get page media

```
GET /api/pages/{route}/media
```

Returns co-located media files for a page.

```json
{
  "items": [
    {
      "name": "cover.jpg",
      "url": "/content-media/02.blog/01.hello-world/cover.jpg",
      "type": "image/jpeg",
      "size": 48320
    }
  ],
  "total": 1
}
```

## Collections

### Query a collection

```
GET /api/collections/{route}
```

Returns the collection defined in the page's frontmatter, resolved with current pagination.

Query parameters:

| Param | Type | Description |
|-------|------|-------------|
| `page` | number | Pagination page number |

## Taxonomy

### List all taxonomies

```
GET /api/taxonomy
```

Returns all taxonomy types with their values and page counts.

```json
{
  "tag": {
    "deno": 12,
    "fresh": 8,
    "cms": 3
  },
  "category": {
    "tutorials": 5,
    "announcements": 2
  }
}
```

### List taxonomy values

```
GET /api/taxonomy/{name}
```

Returns all values for a taxonomy type with page counts.

```json
{
  "name": "tag",
  "values": {
    "deno": 12,
    "fresh": 8,
    "cms": 3
  }
}
```

### Get pages by taxonomy

```
GET /api/taxonomy/{name}/{value}
```

Returns all pages with a specific taxonomy value.

## Search

### Full-text search

```
GET /api/search?q={query}
```

Query parameters:

| Param | Type | Description |
|-------|------|-------------|
| `q` | string | Search query |
| `limit` | number | Maximum results |
| `template` | string | Filter by template |

Response:
```json
{
  "query": "deno fresh",
  "results": [
    {
      "route": "/blog/hello-world",
      "title": "Hello World",
      "excerpt": "...built with <mark>Deno</mark> and <mark>Fresh</mark>...",
      "score": 0.95
    }
  ],
  "total": 3
}
```

## Site Configuration

### Get site config

```
GET /api/config/site
```

Returns the public site configuration values.

```json
{
  "title": "My Site",
  "description": "A site built with Dune CMS",
  "url": "https://example.com",
  "author": { "name": "Jane Doe" },
  "metadata": {},
  "taxonomies": ["tag", "category"]
}
```

## Navigation

### Get navigation tree

```
GET /api/nav
```

Returns the ordered navigation tree of visible pages.

```json
{
  "items": [
    {
      "route": "/",
      "title": "Home",
      "order": 1,
      "depth": 0,
      "template": "default"
    },
    {
      "route": "/blog",
      "title": "Blog",
      "order": 2,
      "depth": 0,
      "template": "blog"
    }
  ]
}
```

## Content Media

### Serve media file

```
GET /content-media/{source-path}/{filename}
```

Serves co-located media files. These URLs are generated automatically when resolving image references in Markdown.
