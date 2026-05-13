# Skill: Dune Content

Content conventions — file layout, naming, frontmatter, formats, templates, querying, taxonomy, and language variants.

---

## File layout and naming

```
content/
  01.home/
    default.md          → route: /home  (or / if homepage: 01.home)
  02.blog/
    default.md          → route: /blog
    01.hello-world.md   → route: /blog/hello-world
    02.second-post.md   → route: /blog/second-post
  03.about/
    default.md          → route: /about
  _components/          → non-routable — module folder (underscore prefix)
    hero.tsx
  _drafts/              → non-routable — draft folder
    wip-post.md
```

### Naming rules

| Convention | Effect |
|-----------|--------|
| `01.` numeric prefix on folder or file | Stripped from route; controls sort order in collections |
| `default.md` inside a folder | That folder's index page (`/blog/default.md` → `/blog`) |
| `_name/` underscore prefix | Non-routable module folder — use for shared components and partials |
| `_drafts/` | Non-routable — excluded from content index in all environments |
| `draft: true` in frontmatter | Excluded from content index in production; visible in dev |

### Homepage

```yaml
# site.yaml
site:
  homepage: 01.home     # folder whose default.md serves as /
```

Without `homepage:` config, `content/default.md` is `/`.

---

## Frontmatter reference

```yaml
---
title: My Post                    # required by convention
description: SEO meta description
template: post                    # theme template — defaults to "default"
publishedAt: 2026-05-13
draft: false
tags: [deno, cms, tutorial]       # taxonomy
category: technical               # taxonomy
roles: member                     # content gating — see dune-authz skill
---
```

All frontmatter fields are optional except `title` (required by convention, not enforced). Unknown fields are passed through to the template as `page.frontmatter.*`.

### `roles:` syntax

```yaml
roles: member                     # single group (user must be a member)
roles: [member, admin]            # any of these (OR)
roles:
  all: [member, verified]         # all of these (AND)
```

Content gating is checked automatically — do not add manual middleware for content pages. See **dune-authz** skill.

---

## Content formats

### Markdown (`.md`) — default

Standard Markdown with YAML frontmatter. HTML is sanitized by default (`trusted_html: false` in `site.yaml`). Safe for untrusted authors.

### MDX (`.mdx`) — Markdown with JSX

```mdx
---
title: Interactive Post
template: post
---

import { Chart } from "./Chart.tsx"

## Results

<Chart data={frontmatter.data} />

Standard **markdown** continues here.
```

Co-located imports (`./Chart.tsx`) are confined to the page's directory — importing from parent directories or absolute paths is blocked. MDX pages run with the same trust level as Markdown.

### TSX content pages (`.tsx` or `format: tsx`) — full component

```tsx
// content/blog/dashboard.tsx
import type { ContentPageProps } from "@dune/content/types";
import { db } from "@/db";

export default async function Dashboard({ route, page }: ContentPageProps) {
  const comments = await db.comments.find({
    where: { pageRoute: route },
    orderBy: { field: "createdAt", dir: "desc" },
  });

  return (
    <article>
      <h1>{page.title}</h1>
      {comments.map(c => (
        <div key={c.id}>
          <strong>{c.author}</strong>
          <p>{c.body}</p>
        </div>
      ))}
    </article>
  );
}
```

**TSX content pages run with full Deno permissions.** They can read files, make network requests, and access environment variables. Gate TSX format to trusted authors only — equivalent trust level to admin. See [[testing/tsx-content-sandbox]].

---

## Theme templates

Theme templates live in `themes/<name>/templates/*.tsx`. They receive rendered content and page metadata. They are not content files — they are the rendering layer.

```tsx
// themes/default/templates/post.tsx
import type { TemplateProps } from "@dune/content/types";
import { db } from "@/db";

export default async function PostTemplate({ page, content, site }: TemplateProps) {
  const comments = await db.comments.find({
    where: { pageRoute: page.route },
    orderBy: "createdAt",
  });

  return (
    <article>
      <h1>{page.title}</h1>
      <div dangerouslySetInnerHTML={{ __html: content }} />
      {comments.map(c => <div key={c.id}>{c.body}</div>)}
    </article>
  );
}
```

| Prop | Type | Contents |
|------|------|----------|
| `page` | `PageMeta` | Frontmatter, route, template name, language |
| `content` | `string` | Rendered HTML (from md/mdx source) |
| `site` | `SiteConfig` | Values from `site.yaml` |

`content` is the rendered HTML of the Markdown/MDX body. For TSX content pages, the content file IS the component — no template is involved.

Referencing a template that doesn't exist in the active theme is a validation error caught by `dune validate`.

---

## Querying content

In plugin hooks, background jobs, and TSX templates:

```ts
// Find all posts, newest first
const posts = await ctx.content.find({
  type: "post",                    // folder name (without numeric prefix)
  where: { draft: false },
  orderBy: "publishedAt",
  limit: 10,
});

// Find by taxonomy
const techPosts = await ctx.content.find({
  type: "post",
  taxonomy: { category: "technical" },
});

// Find a single page by route
const page = await ctx.content.findOne({ route: "/blog/hello-world" });
```

`type` maps to the folder name with the numeric prefix stripped. Posts in `02.blog/` have `type: "blog"` — not `"02.blog"`, not `"post"`.

---

## Taxonomy

Taxonomy values are aggregated across all pages automatically. No schema definition required — any frontmatter field used as a taxonomy just needs to be listed in `site.yaml`:

```yaml
# site.yaml
content:
  taxonomies:
    - tags
    - category
```

Access taxonomy values in templates or plugins:

```ts
const allCategories = await ctx.content.getTaxonomyValues("category");
const tagged = await ctx.content.find({
  taxonomy: { tags: "deno" },     // pages where tags includes "deno"
});
```

---

## Language variants

```
content/02.blog/
  hello-world.md         → /blog/hello-world  (default language)
  hello-world.de.md      → /de/blog/hello-world
  hello-world.fr.md      → /fr/blog/hello-world
```

Language must be listed in `site.yaml` to be detected:

```yaml
# site.yaml
i18n:
  defaultLanguage: en
  languages: [en, de, fr]
```

An unlisted language code in a filename is treated as part of the slug, not a language variant.

---

## Co-located media

Images and assets can sit alongside content files:

```
content/02.blog/
  hello-world.md
  hero.png               → referenced as ![alt](./hero.png) in the .md file
  chart.svg
```

Relative media references in Markdown resolve relative to the content file's directory. Absolute paths (`/uploads/hero.png`) resolve from the project root.

`.html` and `.svg` files served as media get a sandbox CSP header to prevent XSS. Do not rely on inline scripts in co-located `.html` files — they will be blocked.

---

## Agent tooling

### Scaffold a new page
Use `dune content:create` to create a correctly-structured page without guessing the numeric-prefix convention:

```sh
dune content:create /blog/my-post                         # creates content/02.blog/01.my-post/default.md
dune content:create /blog/my-post --title "My Post"       # custom title
dune content:create /blog/my-post --template blog-post    # sets template in frontmatter
dune content:create /blog/my-post --publish               # marks published: true
dune content:create /about --flat                         # creates content/about.md (no subfolder)
dune content:create /blog/my-post --json                  # prints { created, route, path, title }
```

The command detects existing numeric-prefix folders (e.g. `02.blog/`) and places new content inside, incrementing the inner counter automatically.

### Read a page's current source
Use the HTTP API to read current content before editing:

```sh
# Requires admin auth
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/admin/api/page-source?route=/blog/my-post"
# Returns: { route, sourcePath, format, content, frontmatter, body, mtime }
```

### Preview rendered output
Validate how content will render before writing it:

```sh
curl -X POST -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/admin/api/render-markdown" \
  -d '{"content": "---\ntitle: Test\n---\n\n# Hello"}'
# Returns: { html, frontmatter, warnings }
```

### Discover frontmatter schemas
Before creating content for a specific template, check what fields are expected:

```sh
dune blueprint:list                 # list all blueprints
dune blueprint:show blog-post       # show required + optional fields with examples
dune blueprint:show blog-post --json  # machine-readable
```

### Safe editing workflow
1. `GET /admin/api/page-source?route=<route>` — read current content
2. Make your edits to the content string
3. `POST /admin/api/render-markdown` with modified content — preview HTML
4. `POST /admin/api/dev/apply` with `dry_run: true` — validate path/YAML/ops
5. `POST /admin/api/dev/apply` with `dry_run: false` — write to disk

---

## Gotchas

**Numeric prefix is stripped from routes.** `01.blog/01.hello-world.md` produces the route `/blog/hello-world`, not `/01.blog/01.hello-world`. Never construct URLs using the prefix.

**`default.md` is the folder index.** A file literally named `default.md` inside a folder maps to that folder's route. Any other filename (`index.md`, `home.md`) is a separate page — not the folder index.

**Underscore folders are non-routable.** `_components/` and `_drafts/` produce no routes. Do not put content that should be publicly accessible in a folder with an underscore prefix.

**`type` in content queries is the stripped folder name.** Posts in `02.blog/` are `type: "blog"`. Posts in `posts/` are `type: "posts"`. Never include the numeric prefix in a `type` query.

**`template:` in frontmatter must match an actual file in the active theme.** `template: fancy` requires `themes/<active>/templates/fancy.tsx` to exist. `dune validate` catches this before the server starts.

**TSX content pages require trusted authors.** They run with full Deno permissions — no sandbox. Do not allow untrusted users to create `.tsx` content files. Use Markdown or MDX for user-generated content.

**Language code must be configured to be detected.** `post.de.md` is not treated as a German variant unless `de` is listed in `site.yaml` under `i18n.languages`. Without that config, the filename is treated as a slug containing a literal dot — producing an unexpected route.

**`draft: true` behaves differently in dev vs production.** Draft pages are excluded from the content index in production but visible in development. Don't rely on draft status as a security gate — use `roles:` frontmatter for access control.
