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
| `limit` | number | Maximum pages to return (default: 20) |
| `offset` | number | Skip N pages (default: 0) |
| `template` | string | Filter by template name |

Only published, routable pages are returned.

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

Returns the full page object including rendered HTML content. The `{route}` segment starts with `/` — e.g. `/api/pages/blog/hello-world` returns the page at route `/blog/hello-world`.

```json
{
  "route": "/blog/hello-world",
  "title": "Hello World",
  "date": "2025-06-15",
  "template": "post",
  "format": "md",
  "html": "<h1>Hello World</h1><p>This is my first post...</p>",
  "frontmatter": { "...": "all frontmatter fields" },
  "media": [
    { "name": "cover.jpg", "url": "/content-media/02.blog/01.hello-world/cover.jpg", "type": "image/jpeg" }
  ]
}
```

Returns `404` if no page exists at that route.

## Taxonomy

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

Returns `404` if the taxonomy name is not defined in the site config.

## Content Media

### Serve media file

```
GET /content-media/{source-path}/{filename}
```

Serves co-located media files. These URLs are generated automatically when resolving image references in Markdown. Responses include a one-hour `Cache-Control` header.
