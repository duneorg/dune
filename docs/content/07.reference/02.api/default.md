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

CORS is supported on all endpoints. The `Access-Control-Allow-Origin` header is set to the origin derived from your `site.url` config value — not a wildcard. This means API requests must originate from the same domain as your configured site URL. Preflight `OPTIONS` requests return `204` with appropriate CORS headers.

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
| `published` | boolean | Filter by publish status. Omit to return only published pages. |
| `order` | string | Sort as `field:direction` — e.g. `date:desc`, `title:asc`, `order:asc` |
| `taxonomy.{name}` | string | Filter by taxonomy value — e.g. `taxonomy.tag=deno` |

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
        "tag": ["deno", "fresh"]
      }
    }
  ],
  "meta": {
    "total": 42,
    "page": 1,
    "pages": 3,
    "limit": 20
  }
}
```

### Get a single page

```
GET /api/pages/{route}
```

Returns the full page object including rendered HTML and raw content. The `{route}` segment starts with `/` — e.g. `/api/pages/blog/hello-world` returns the page at route `/blog/hello-world`.

```json
{
  "route": "/blog/hello-world",
  "title": "Hello World",
  "date": "2025-06-15",
  "template": "post",
  "format": "md",
  "rawContent": "---\ntitle: Hello World\n---\n\n# Hello World\n...",
  "html": "<h1>Hello World</h1><p>This is my first post...</p>",
  "frontmatter": { "title": "Hello World", "date": "2025-06-15" },
  "media": [
    { "name": "cover.jpg", "url": "/content-media/02.blog/01.hello-world/cover.jpg", "type": "image/jpeg", "size": 48320 }
  ]
}
```

Returns `404` (as `{ "error": "Not found" }`) if no page exists at that route.

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

Returns all co-located media files for a page, including sidecar metadata.

```json
{
  "items": [
    {
      "name": "cover.jpg",
      "url": "/content-media/02.blog/01.hello-world/cover.jpg",
      "type": "image/jpeg",
      "size": 48320,
      "meta": { "alt": "A sunset", "credit": "Photo by Jane Doe" }
    }
  ],
  "total": 1
}
```

## Collections

### Query a collection

```
GET /api/collections
```

Returns a filtered, ordered, paginated set of pages. Build queries with query parameters rather than frontmatter definitions.

Query parameters:

| Param | Type | Description |
|-------|------|-------------|
| `source` | string | Collection source (default: `@self.children`). See below. |
| `order` | string | Sort field: `date` (default), `title`, `order` |
| `dir` | string | Sort direction: `desc` (default), `asc` |
| `limit` | number | Items per page (default: 20) |
| `offset` | number | Skip N items (default: 0) |
| `template` | string | Filter by template name |

**Source values:**
- `@self.children` — all direct children (default)
- `@page.children:/blog` — children of a specific page
- `@page.descendants:/blog` — all descendants of a page
- `@taxonomy.tag:deno` — pages with a specific taxonomy value

Response:
```json
{
  "items": [
    {
      "route": "/blog/hello-world",
      "title": "Hello World",
      "date": "2025-06-15",
      "template": "post",
      "format": "md"
    }
  ],
  "meta": {
    "total": 42,
    "page": 1,
    "pages": 3,
    "hasNext": true,
    "hasPrev": false
  }
}
```

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

Returns `404` if the taxonomy name is not defined in the site config.

### Get pages by taxonomy value

```
GET /api/taxonomy/{name}/{value}
```

Returns all pages with a specific taxonomy value.

```json
{
  "taxonomy": "tag",
  "value": "deno",
  "items": [
    {
      "route": "/blog/hello-world",
      "title": "Hello World",
      "date": "2025-06-15",
      "template": "post",
      "format": "md"
    }
  ],
  "total": 12
}
```

## Search

### Full-text search

```
GET /api/search
```

Query parameters:

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `q` | string | `""` | Search query |
| `template` | string | — | Filter by template name |
| `published` | `"true"` \| `"false"` | — | Filter by publish status |
| `lang` | string | — | Filter by language code |
| `from` | string | — | Min date (`YYYY-MM-DD`) |
| `to` | string | — | Max date (`YYYY-MM-DD`) |
| `taxonomy[{name}][]` | string | — | Filter by taxonomy value (repeatable) |
| `limit` | number | 20 (max 100) | Maximum results |

Response:
```json
{
  "query": "deno",
  "total": 3,
  "items": [
    {
      "route": "/blog/hello-world",
      "title": "Hello World",
      "template": "post",
      "date": "2025-06-15",
      "taxonomy": { "tag": ["deno"] },
      "excerpt": "...built with deno and fresh...",
      "score": 8.5
    }
  ],
  "filters": {
    "taxonomy": { "tag": ["deno"] }
  }
}
```

Returns an empty `items` array (not a 404) if no results are found or `q` is omitted.

### Autocomplete suggestions

```
GET /api/search/suggest?q={prefix}
```

| Param | Type | Description |
|-------|------|-------------|
| `q` | string | Prefix text (minimum 2 characters) |

Response:
```json
{
  "suggestions": ["deno", "deploy", "Dune CMS"]
}
```

Returns up to 10 suggestions matching indexed terms and page titles. Returns an empty array for prefixes shorter than 2 characters.

## Site Configuration

### Get site config

```
GET /api/config/site
```

Returns public site configuration values.

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

Returns the ordered navigation tree of all visible pages.

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

Serves co-located media files. These URLs are generated automatically when resolving image references in Markdown. Responses include a one-hour `Cache-Control` header.

### On-the-fly image processing

Append image processing parameters to any image URL to transform it on demand:

```
GET /content-media/{source-path}/{filename}?width=800&format=webp
```

Query parameters:

| Param | Alias | Type | Description |
|-------|-------|------|-------------|
| `width` | `w` | number | Target width in pixels. Must be in `allowed_sizes`. |
| `height` | `h` | number | Target height in pixels. Must be in `allowed_sizes`. |
| `quality` | `q` | number | Output quality 1–100 (default: 80). |
| `format` | `f` | string | Output format: `jpeg`, `png`, `webp`, `avif`. |
| `fit` | — | string | Resize fit mode: `cover` (default), `contain`, `fill`, `inside`, `outside`. |
| `focal` | — | string | Focal point for cover crop as `x,y` percentages: `50,30` = center-top. |

Processing is activated when at least one of `width`, `height`, `quality`, or `format` is present.

Supported input formats: `.jpg`, `.jpeg`, `.png`, `.webp`, `.avif`, `.gif`, `.tiff`.

**Constraints:**
- `width` and `height` must be values in `system.images.allowed_sizes` — other values return `400`.
- Maximum dimension is capped at 4096px.
- Invalid `focal` values are silently ignored (falls back to center crop).

Processed images are cached with `Cache-Control: public, max-age=31536000, immutable`. The response also includes diagnostic headers `X-Dune-Image`, `X-Dune-Image-Width`, and `X-Dune-Image-Height`.

## Flex Objects

Flex Objects are schema-driven custom data types managed outside the content tree. See the [Flex Objects](/flex-objects) documentation for schema authoring details.

### List records

```
GET /api/flex/{type}
```

Returns all records for the given type, sorted newest first.

```json
[
  {
    "_id": "a3f2c19d0e8b",
    "_type": "products",
    "_createdAt": 1741234567890,
    "_updatedAt": 1741234567890,
    "name": "Ceramic Mug",
    "price": 24.00,
    "published": true
  }
]
```

Returns `404` if the type schema does not exist. Returns an empty array if the type exists but has no records.

### Get a single record

```
GET /api/flex/{type}/{id}
```

Returns a single record by its ID.

```json
{
  "_id": "a3f2c19d0e8b",
  "_type": "products",
  "_createdAt": 1741234567890,
  "_updatedAt": 1741234567890,
  "name": "Ceramic Mug",
  "price": 24.00,
  "published": true
}
```

Returns `404` if the type or record does not exist.
