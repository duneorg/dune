---
title: "Static Site Generation"
published: true
visible: true
taxonomy:
  audience: [webmaster, developer]
  difficulty: [beginner]
  topic: [deployment, ssg, static]
metadata:
  description: "Generate a fully static site with dune build --static and deploy to Netlify, Cloudflare Pages, or any static host"
---

# Static Site Generation

`dune build --static` renders every published page to plain HTML files and copies all assets to a `dist/` folder. The result can be uploaded to any static host — Netlify, Cloudflare Pages, GitHub Pages, an S3 bucket, or a plain web server.

## Quick start

```bash
# Full static build
dune build --static

# Deploy (example: Netlify CLI)
netlify deploy --dir=dist --prod
```

That's it. The `dist/` directory contains everything the static host needs to serve your site.

## What gets generated

| File | Source |
|------|--------|
| `index.html` | Home page |
| `{route}/index.html` | Every published content page |
| `flex/{type}/index.html` | Flex object list pages |
| `flex/{type}/{id}/index.html` | Flex object detail pages |
| `search/index.html` | Search page (JavaScript-driven on static hosts) |
| `sitemap.xml` | Generated from content index, using `--base-url` or `config.site.url` |
| `feed.xml`, `atom.xml` | RSS and Atom feeds |
| `robots.txt` | Copied from `static/robots.txt`, or a sensible default |
| `404.html` | Custom `/404` page if present, otherwise a minimal fallback |
| `static/` | Site-level static assets |
| `themes/{name}/static/` | Active theme's static assets |
| `plugins/{name}/` | Plugin assets |
| `content-media/` | All co-located media files (images, PDFs, downloads, etc.) |

## Options

```bash
dune build --static [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `--out <dir>` | `dist` | Output directory |
| `--base-url <url>` | `config.site.url` | Canonical base URL for sitemap and feeds |
| `--no-incremental` | — | Rebuild all pages, ignoring the change manifest |
| `--concurrency <n>` | `8` | Parallel page renders |
| `--hybrid` | — | Emit edge deployment routing config (see below) |
| `--include-drafts` | — | Include unpublished pages |
| `--verbose` | — | Print each rendered route |
| `--debug` | — | Verbose bootstrap output |

### Examples

```bash
# Override base URL (important for correct sitemap URLs)
dune build --static --base-url https://example.com

# Force full rebuild
dune build --static --no-incremental

# High-parallelism rebuild for a large site
dune build --static --concurrency 16

# Verbose output to audit what was rendered
dune build --static --verbose
```

## Incremental builds

By default Dune tracks a SHA-256 hash of each page's source file in `dist/.dune-build.json`. On subsequent builds, only pages whose source content has changed are re-rendered. This keeps CI builds fast even for large sites.

```bash
# First build — renders everything
dune build --static
# Output: 124 pages rendered

# Second build — content unchanged
dune build --static
# Output: 0 pages rendered, 124 pages skipped (unchanged)

# After editing one post
dune build --static
# Output: 1 pages rendered, 123 pages skipped (unchanged)
```

Disable incremental mode to guarantee a complete rebuild:

```bash
dune build --static --no-incremental
```

> The manifest file `dist/.dune-build.json` should be committed alongside the rest of `dist/` in CI/CD pipelines that preserve the build cache between runs.

## Image handling

Image processing (the `?w=800&q=80` query-string resizing) runs on-demand in server mode but is **skipped in static builds**. Source images are copied as-is to `dist/content-media/`.

Most static hosts serve the raw file and silently discard query-string parameters, so themes that use image processing URLs (`/content-media/hero.jpg?w=1200`) continue to work — they simply get the full-resolution source image instead of a resized one. This is acceptable for the vast majority of static deployments.

> If your theme relies heavily on server-side image resizing, continue running Dune as a dynamic server (`dune serve`) and use a CDN in front for edge caching.

## Hybrid mode

Use `--hybrid` when you want static pages served from a CDN but still need the admin panel and API endpoints to run on a server.

```bash
dune build --static --hybrid
```

In addition to the normal output, this writes three files that instruct edge platforms to route dynamic requests to your running server:

| File | Platform |
|------|----------|
| `dist/_routes.json` | Cloudflare Pages |
| `dist/_redirects` | Netlify |
| `dist/_headers` | Security headers for all platforms |

The default dynamic routes are `/admin/*` and `/api/*`. Everything else is served statically.

### Hybrid deployment workflow

```
Static files  →  CDN  →  served from dist/
API / admin   →  CDN  →  proxied to dune serve
```

For Cloudflare Pages:
1. Connect your repository.
2. Build command: `dune build --static --hybrid --base-url https://example.com`
3. Output directory: `dist`
4. Add a Pages Function at `/functions/[[path]].ts` that proxies to your Dune server for matched routes.

For Netlify:
1. Build command: `dune build --static --hybrid --base-url https://example.com`
2. Publish directory: `dist`
3. The generated `_redirects` file routes `/admin/*` and `/api/*` to a Netlify Function that proxies to your server.

## Deployment examples

### Netlify

```toml
# netlify.toml
[build]
  command = "dune build --static --base-url https://example.com"
  publish = "dist"
```

### Cloudflare Pages

Configure in the dashboard or via Wrangler:
```toml
# wrangler.toml
[pages_build_output_dir]
directory = "dist"
```

Build command in dashboard: `dune build --static --base-url https://example.com`

### GitHub Pages

```yaml
# .github/workflows/deploy.yml
- name: Build
  run: dune build --static --base-url https://username.github.io/repo

- name: Deploy
  uses: peaceiris/actions-gh-pages@v3
  with:
    github_token: ${{ secrets.GITHUB_TOKEN }}
    publish_dir: ./dist
```

### AWS S3 + CloudFront

```bash
dune build --static --base-url https://example.com
aws s3 sync dist/ s3://my-bucket --delete
aws cloudfront create-invalidation --distribution-id XXXXX --paths "/*"
```

## Known limitations

- **Image processing**: source images are copied raw; `?w=…&q=…` resizing only works in server mode.
- **Admin panel**: not included in the static output; run `dune serve` alongside if you need it.
- **Real-time search**: the `/search` page is rendered as a static HTML shell; dynamic search results require JavaScript calling `/api/search` on a running server. If no server is available, use a client-side search library (e.g. Pagefind) against the static output.
- **Forms**: `POST /api/forms/*` endpoints require a running server; forms in the static output will not submit without a backend.
