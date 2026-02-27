---
title: "Sitemap"
published: true
visible: true
taxonomy:
  audience: [webmaster, developer]
  difficulty: [beginner]
  topic: [deployment, seo]
metadata:
  description: "Automatic sitemap generation with multilingual hreflang support"
---

# Sitemap

Dune automatically generates an XML sitemap at `/sitemap.xml`. No configuration is required.

## What's included

The sitemap includes a page if ALL of the following are true:

- `published: true` in frontmatter
- The page has a routable URL (not a module/index-only page)
- All ancestor pages in the content tree are also published

Pages excluded from routing (module pages, pages with `published: false`, or pages whose parents are unpublished) are silently omitted.

## URL format

```
https://example.com/sitemap.xml
```

The base URL comes from `site.url` in `config/site.yaml`. Set this to your production domain to generate correct absolute URLs.

## Priority

Each URL's `<priority>` is calculated from its depth in the content tree:

```
priority = max(0.1, 1.0 − depth × 0.2)
```

| Depth | Example | Priority |
|-------|---------|----------|
| 0 (home) | `/` | 1.0 |
| 1 | `/blog` | 0.8 |
| 2 | `/blog/hello-world` | 0.6 |
| 3 | `/blog/2025/hello` | 0.4 |
| 4+ | deeper pages | 0.1 (floor) |

## Change frequency

Each URL includes a `<changefreq>` hint derived from its depth:

| Depth | `<changefreq>` |
|-------|----------------|
| 0 (home) | `daily` |
| 1 | `weekly` |
| 2+ | `monthly` |

This is a hint to crawlers and is not guaranteed to reflect actual update frequency.

## Last modified date

Each URL's `<lastmod>` is the file modification time of the content file, formatted as `YYYY-MM-DD`.

## Multilingual sites

For sites with more than one language configured (see [Multilingual Content](/content/i18n)), the sitemap adds `xhtml:link` alternates to each URL entry:

```xml
<url>
  <loc>https://example.com/about</loc>
  <lastmod>2025-06-15</lastmod>
  <changefreq>weekly</changefreq>
  <priority>0.8</priority>
  <xhtml:link rel="alternate" hreflang="en" href="https://example.com/about"/>
  <xhtml:link rel="alternate" hreflang="de" href="https://example.com/de/about"/>
  <xhtml:link rel="alternate" hreflang="x-default" href="https://example.com/about"/>
</url>
```

Every language variant of a page is grouped by its source content path (with the language suffix stripped). Each variant gets the full set of `hreflang` alternates, and an `x-default` entry always points to the default-language URL.

## Generation timing

| Mode | When generated |
|------|---------------|
| `dune serve` | Once at startup, then cached |
| `dune dev` | Regenerated on each request |

In production (`dune serve`), the sitemap is built once when the server starts. Restart the server after adding or removing pages to update it.
