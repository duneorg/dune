---
title: "Search"
published: true
visible: true
taxonomy:
  audience: [developer]
  difficulty: [beginner]
  topic: [reference, api]
metadata:
  description: "Full-text search index, query syntax, and API endpoint"
---

# Search

Dune includes a built-in full-text search engine that indexes all published, routable content at startup. It is available via the REST API and powers the admin panel's content search.

## How it works

Search uses an in-memory inverted index built from:

- Page **title** (boosted 3×)
- Page **taxonomy values** (boosted 2×)
- Page **body text** (stripped of Markdown/HTML syntax)
- Page **template** name

The index is built once at startup (`dune serve`) or rebuilt on each content change in dev mode (`dune dev`). It is not persisted to disk — a restart triggers a full rebuild.

## Query syntax

Queries are split into terms by whitespace. A term is a sequence of two or more non-punctuation characters. Single-character terms are ignored.

| Behaviour | Example |
|-----------|---------|
| Single term | `deno` — matches pages containing "deno" |
| Multi-term (AND boost) | `deno fresh` — matches pages containing both; all-terms matches are ranked higher |
| Prefix matching | `dep` — also matches "deno", "deploy", "dependencies" |
| Case insensitive | `Deno` and `deno` produce identical results |

There is no special syntax for phrases, boolean operators, or field-specific searches. All terms are matched against the combined text field.

## Relevance scoring

Each result is assigned a score. Higher scores rank first.

| Signal | Score contribution |
|--------|-------------------|
| Term appears in title | +3 per term |
| Exact title match | +5 |
| Term appears in taxonomy value | +2 per match |
| Term appears in body | +1 per occurrence (capped at 5 per term) |
| All terms match | ×1.5 multiplier applied to total |

## REST API

```
GET /api/search?q={query}&limit={n}
```

Query parameters:

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `q` | string | — | Search query (required) |
| `limit` | number | 20 | Maximum results to return |

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
      "taxonomy": { "tag": ["deno"] },
      "score": 8.5,
      "excerpt": "...the Deno runtime makes it easy to..."
    }
  ],
  "meta": {
    "total": 3,
    "query": "deno",
    "limit": 20
  }
}
```

The `excerpt` field is a 120-character window around the first term match in the page body.

An empty query (`q=`) returns an empty `items` array — it does not return all pages.

## Build requirement

The search index is not built automatically in all contexts. In the standard `dune serve` / `dune dev` workflow, the index is built at startup. When using the programmatic API, call `search.build()` after the content index is ready:

```ts
const search = createSearchEngine({ pages, storage, contentDir, formats });
await search.build();  // required before calling search.search()
```

## Limitations

- **In-memory only** — index is lost on restart and rebuilt fresh each time
- **No phrase matching** — `"hello world"` is treated as two separate terms
- **No field-specific queries** — cannot restrict search to title-only or taxonomy-only
- **Published pages only** — unpublished pages are excluded from the index
- **No stemming** — "running" and "run" are distinct terms; prefix matching partially compensates
