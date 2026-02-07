---
title: "Site Configuration"
published: true
visible: true
taxonomy:
  audience: [webmaster]
  difficulty: [beginner]
  topic: [configuration]
metadata:
  description: "Configuring site identity, taxonomies, and routing"
---

# Site Configuration

`config/site.yaml` defines your site's identity and content structure.

## Full reference

```yaml
# Site identity
title: "My Site"
description: "A site built with Dune CMS"
url: "https://example.com"

# Author
author:
  name: "Your Name"
  email: "you@example.com"        # optional

# HTML metadata (becomes <meta> tags)
metadata:
  og:type: "website"
  og:site_name: "My Site"
  twitter:card: "summary_large_image"

# Taxonomy types enabled for this site
taxonomies:
  - category
  - tag
  - author

# Route aliases (URL → URL)
routes:
  "/docs": "/documentation"
  "/blog/rss": "/api/feed"

# Redirects (301 by default)
redirects:
  "/old-page": "/new-page"
  "/legacy/post": "/blog/post"
```

## Key fields

### `title` and `description`

Your site's name and tagline. Used in templates, RSS feeds, and `<meta>` tags.

### `url`

The canonical base URL. Important for generating absolute URLs in sitemaps, RSS feeds, and Open Graph tags. Set this to your production domain.

### `taxonomies`

An array of taxonomy type names. This defines WHICH taxonomies your site uses. Content pages can then use any of these in their frontmatter `taxonomy` block.

Default: `["category", "tag"]`

### `routes` and `redirects`

`routes` are aliases — both URLs serve the same content. `redirects` send visitors to a new URL with a 301 status. Use redirects for old URLs you want to retire; use routes for permanent alternative paths.
