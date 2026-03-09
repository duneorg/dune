---
title: "RSS & Atom Feeds"
published: true
visible: true
taxonomy:
  audience: [webmaster]
  difficulty: [beginner]
  topic: [deployment, seo]
metadata:
  description: "Auto-generated RSS 2.0 and Atom 1.0 feeds from your content"
---

# RSS & Atom Feeds

Dune automatically generates RSS 2.0 and Atom 1.0 feeds from your published, dated content. No configuration is required to get started.

## Feed URLs

| Format | URL | Content-Type |
|--------|-----|--------------|
| RSS 2.0 | `/feed.xml` | `application/rss+xml` |
| Atom 1.0 | `/atom.xml` | `application/atom+xml` |

Both feeds are served at startup and are ready to submit to feed readers and podcast aggregators.

## What's included

A page appears in the feeds if ALL of the following are true:

- `published: true` in frontmatter
- The page has a routable URL
- The page has a `date` field set

Pages without a `date` are excluded — feeds are date-ordered streams and a dateless page has no meaningful position.

Items are sorted newest-first. The default is 20 items; see [Configuration](#configuration) below to adjust.

## Feed discovery

Dune automatically injects `<link rel="alternate">` discovery tags into every HTML response so browsers and feed readers can find your feeds without manual configuration:

```html
<link rel="alternate" type="application/rss+xml" title="My Site" href="/feed.xml">
<link rel="alternate" type="application/atom+xml" title="My Site" href="/atom.xml">
```

These tags are inserted in `<head>` automatically — no changes to your theme are required.

## Configuration

Add a `feed:` block to `config/site.yaml`:

```yaml
feed:
  enabled: true        # Set to false to disable both feeds (default: true)
  items: 20            # Number of most-recent items to include (default: 20)
  content: "summary"   # "summary" (excerpt) or "full" (full HTML) (default: "summary")
```

### `enabled`

Set to `false` to disable feed generation entirely. `/feed.xml` and `/atom.xml` will return 404, and the discovery `<link>` tags will not be injected.

### `items`

The number of most-recent dated pages to include, sorted by `date` descending. Increase this for content-heavy sites; keep it at 20–50 for typical blogs.

### `content`

Controls the body of each feed item:

| Value | Description | Best for |
|-------|-------------|----------|
| `"summary"` | Auto-generated excerpt from page body | Blogs, news (encourages click-through) |
| `"full"` | Fully rendered HTML content | Email newsletters, offline reading |

## Generation timing

| Mode | When generated |
|------|----------------|
| `dune serve` | Once at startup, then cached |
| `dune dev` | Regenerated on each request |

In production (`dune serve`), feeds are built once when the server starts. Restart the server after publishing new content to update the feeds, or use the `/api/rebuild` endpoint if your hosting setup supports it.

## Cover images in feeds

If a page has an `image` frontmatter field, it is included as the feed item's cover image:

```yaml
---
title: "My Post"
date: 2026-03-09
image: cover.jpg
---
```

The image must be a filename co-located with the content file (not an absolute URL). The generated feed item will reference `/content-media/{dir}/cover.jpg`.

## Feed metadata

Feed-level metadata (title, description, author, language) comes directly from `config/site.yaml`:

```yaml
title: "My Blog"
description: "Thoughts on Deno and web development"
url: "https://example.com"
author:
  name: "Jane Doe"
  email: "jane@example.com"
```

Set `url` to your production domain for correct absolute URLs in the feed. Without a valid `url`, item links will be relative and may not work in all feed readers.
