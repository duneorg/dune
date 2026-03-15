---
title: "Multi-Site"
published: true
visible: true
taxonomy:
  audience: [webmaster, developer]
  difficulty: [intermediate]
  topic: [multisite, configuration, deployment]
metadata:
  description: "Run multiple independent sites from a single Dune installation"
---

# Multi-Site

Dune can serve multiple independent sites from a single installation. Each site
gets its own content, config, users, themes, and admin panel. A thin router sits
in front of all sites and dispatches requests by hostname or URL path prefix.

---

## Directory Layout

```
/install
├── config/
│   └── sites.yaml          ← multi-site config (triggers multi-site mode)
├── shared/
│   └── themes/             ← optional shared theme pool
├── sites/
│   ├── main/               ← site 1 (standard Dune layout)
│   │   ├── config/
│   │   ├── content/
│   │   └── themes/
│   └── blog/               ← site 2
│       ├── config/
│       ├── content/
│       └── themes/
```

Multi-site mode is detected automatically: if `config/sites.yaml` exists at the
installation root, Dune starts in multi-site mode. Single-site installs are
completely unaffected.

---

## `config/sites.yaml`

```yaml
# config/sites.yaml
shared_themes_dir: ./shared/themes    # optional — shared theme pool

sites:
  - id: main
    root: ./sites/main
    default: true           # catch-all fallback

  - id: blog
    root: ./sites/blog
    hostname: blog.example.com

  - id: docs
    root: ./sites/docs
    path_prefix: /docs      # strip /docs before dispatching
```

### Fields

| Field | Type | Description |
|---|---|---|
| `id` | string | **Required.** Unique identifier used in cross-site collections. |
| `root` | string | **Required.** Path to the site directory (relative to `config/sites.yaml`). |
| `hostname` | string | Route requests matching this `Host` header to this site. |
| `path_prefix` | string | Route requests whose path starts with this prefix. The prefix is stripped before the request is dispatched. |
| `default` | boolean | Make this the catch-all fallback. Defaults to the first entry. |

`hostname` and `path_prefix` are mutually exclusive.

### Top-level keys

| Key | Description |
|---|---|
| `shared_themes_dir` | Path to a directory of shared themes. Sites that reference a theme not found in their own `themes/` directory will fall back here. |
| `shared_plugins_dir` | Informational only (v0.4). Sites can reference shared plugins via relative paths in their own `config/site.yaml`. |

---

## Routing

Request dispatch uses this priority:

1. **Exact hostname match** — `Host` header equals `entry.hostname`
2. **Longest path prefix match** — `URL.pathname` starts with `entry.path_prefix`
3. **Default fallback** — first site with `default: true`, or the first entry

For prefix-routed sites, the prefix is stripped from the URL before the
site's own router processes the request. So `/docs/getting-started` becomes
`/getting-started` inside the docs site.

---

## Admin Panels

Each site has its own admin panel at its configured `admin.path` (default
`/admin`). Sessions do not cross site boundaries.

For a prefix-routed site with `path_prefix: /docs`, the admin is reachable
externally at `/docs/admin/`.

---

## Shared Themes

Set `shared_themes_dir` in `sites.yaml` to point at a directory containing
reusable themes. When a site's `theme.name` is not found in that site's own
`themes/` directory, Dune checks the shared pool automatically.

```yaml
# sites/main/config/site.yaml
theme:
  name: corporate    # resolved from shared/themes/corporate/
```

> **Limitation (v0.4):** Child–parent theme inheritance is not supported
> across storage boundaries. If you use theme inheritance, both the child and
> parent themes must live in the same location (site-local or shared).

---

## Cross-Site Collections

Pages from one site can appear in a collection on another site using the
`@site.*` collection sources:

```yaml
# In a page's frontmatter on the "main" site:
collection:
  items:
    "@site.children": "blog:/posts"   # direct children of /posts in the blog site
```

```yaml
  items:
    "@site.descendants": "docs:/api"  # all descendants of /api in the docs site
```

The syntax is `"siteId:/route"`. The site ID must match an `id` in
`config/sites.yaml`. In single-site mode, `@site.*` sources return an empty
list silently.

---

## Dev Mode

```bash
dune dev --root /install
```

Multi-site dev mode starts a single HTTP server serving all sites. Each site
gets its own file watcher and its own SSE live-reload channel — editing a file
in `sites/blog/content/` reloads only browsers connected to the blog site.

---

## Production

```bash
dune serve --root /install
```

Single process, single port. All sites are bootstrapped at startup; the
request router runs in memory with no overhead.

---

## Example: Hostname Routing

```
# Request: GET / Host: blog.example.com  → blog site
# Request: GET /                         → main site (default)
# Request: GET /rss.xml                  → main site feed
```

## Example: Path-Prefix Routing

```
# Request: GET /docs/getting-started  → docs site, path /getting-started
# Request: GET /docs/admin/           → docs site admin panel
# Request: GET /                      → main site (default)
```
