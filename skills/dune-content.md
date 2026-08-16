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
# site.yaml — top level, no "site:" wrapper key in the file itself
homepage: 01.home     # folder whose default.md serves as /
```

`site.yaml`'s own top-level fields (`homepage`, `taxonomies`, `title`, etc.) map into `config.site.*` at load time — you never write a literal `site:` key inside `site.yaml`. Without `homepage:` config, `content/default.md` is `/`.

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
import type { ContentPageProps } from "@dune/core/content/types"; // not "@dune/content/types" — no such package
import { db } from "@/db";

export default async function Dashboard({ route, site }: ContentPageProps) {
  const comments = await db.comments.find({
    where: { pageRoute: route },
    orderBy: ["createdAt", "desc"], // a tuple — see dune-schemas; not { field, dir }
  });

  return (
    <article>
      <h1>{site.title} — dashboard</h1>
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

**`ContentPageProps` has no `page`/`frontmatter` field at all** (`src/content/types.ts`) — only `site`, `config`, `route`, `media`, `params`, and an optional `collection`. A TSX content page can't read its own frontmatter through props the way a template can through `TemplateProps.page` — there's no `content`/`ctx` on these props either (see "Querying content" below), so the only way to get it yourself is via whatever's reachable from `import { db } from "@/db"`-style module-level access outside the props, or by just building the page's content directly in the component, which is the more common case — TSX content pages exist for pages that are mostly-code (dashboards, dynamic listings), not frontmatter-driven ones.

**TSX content pages run with full Deno permissions.** They can read files, make network requests, and access environment variables. Gate TSX format to trusted authors only — equivalent trust level to admin. See [[testing/tsx-content-sandbox]].

---

## Theme templates

Theme templates live in `themes/<name>/templates/*.tsx`. They receive rendered content and page metadata. They are not content files — they are the rendering layer.

```tsx
// themes/default/templates/post.tsx
import type { TemplateProps } from "@dune/core/content/types"; // not "@dune/content/types" — no such package
import { db } from "@/db";

export default async function PostTemplate({ page, children, site }: TemplateProps) {
  const comments = await db.comments.find({
    where: { pageRoute: page.route },
    orderBy: "createdAt", // bare key = ascending; ["createdAt", "desc"] for descending
  });

  return (
    <article>
      <h1>{page.frontmatter.title}</h1>
      <div>{children}</div>
      {comments.map(c => <div key={c.id}>{c.body}</div>)}
    </article>
  );
}
```

| Prop | Type | Contents |
|------|------|----------|
| `page` | `Page` (not `PageMeta` — that type doesn't exist) | `page.frontmatter` for YAML fields (**not** `page.title` — `Page` has no top-level `title`), `page.route`, `page.template`, `page.language`, `page.sourcePath` |
| `children` | `unknown` | Pre-rendered content — a Preact vnode already wrapping the rendered HTML of the md/mdx body |
| `site` | `SiteConfig` | Values from `site.yaml` |
| `content` | `ContentApi \| undefined` | `.pages()`/`.page()`/`.search()`/`.taxonomy()` — same instance as `bootstrap.contentApi`. Populated on every normal render; see "Querying content" below for the rare fallback paths that omit it. |

`children` is already a rendered vnode, not a raw HTML string — render it directly (`<div>{children}</div>`), don't pass it to `dangerouslySetInnerHTML`. For TSX content pages, the content file IS the component — no template is involved, but `ContentPageProps` gets the same `content` field.

```tsx
// themes/default/templates/related.tsx — using content instead of a direct db call
import type { TemplateProps } from "@dune/core/content/types";

export default async function RelatedTemplate({ page, children, content }: TemplateProps) {
  const related = await content?.search(page.frontmatter.title, { limit: 5 });
  return (
    <article>
      <div>{children}</div>
      <ul>{related?.map(r => <li key={r.route}><a href={r.route}>{r.title}</a></li>)}</ul>
    </article>
  );
}
```

Referencing a template that doesn't exist in the active theme is a validation error caught by `dune validate`.

---

## Querying content

**There is no `ctx.content.find()`/`findOne()`, and no `type:` filter — and `ctx.content`/`props.content` doesn't mean quite the same thing in every context, even though all four carry it.** What you actually get, and how reliably, depends on where you are:

- **Hooks (`HookContext`)** — `ctx.content` is the real `ContentApi` (see below) **once `bootstrap()` has finished building it** — `undefined` before that. Five hooks fire too early to have it: `onConfigLoaded`, `onStorageReady`, `onContentIndexReady`, `onSearchRecordsCollect`, `onSearchEngineCreate`. It's populated for every other live hook. It's also `undefined` on the lightweight, standalone `HookRegistry` instances `content:create` and `migrate:*` (`--fire-hooks`) build outside a full `bootstrap()` — `content:delete` is not in that group, since it runs through a real `bootstrap()`. Always guard with `ctx.content?.`. `onContentIndexReady`'s `data` (the raw `PageIndex[]`) is still the only thing available during the earliest hooks — see `dune-plugin-authoring`.
- **Background jobs (`JobContext`)** — two separate fields: `ctx.content` is still the full `DuneEngine` (`.pages` a plain array property, `.loadPage(sourcePath)` for one full `Page`), kept exactly as-is so existing jobs don't break; `ctx.contentApi` is the same `ContentApi` described below, and — unlike hooks' `ctx.content` — is **always present**, since jobs only ever run after bootstrap has fully completed. See `dune-jobs`.
- **TSX content pages / theme templates** (`ContentPageProps.content`, `TemplateProps.content`) — the same `ContentApi`, threaded through `duneRoutes()` → `content-handler.ts`/`tsx-handler.ts`/`error-page.ts` at request time. Optional on the type (a couple of edge-case fallback paths — e.g. the bare-HTML fallback when no theme resolves at all, which doesn't use `TemplateProps`/JSX rendering in the first place — don't populate it), but every normal template/TSX-page render call site does, since rendering only ever happens after a full `bootstrap()`.
- **The real `ContentApi`** (`src/content/api.ts` — `.pages()`, `.page()`, `.search()`, `.taxonomy()`) is exposed as `bootstrap.contentApi` — reachable from a plugin's `mount({ bootstrap })`, or anywhere else holding a `BootstrapResult`. It's the same instance injected as `ctx.content` in hooks, `ctx.contentApi` in jobs, and `content` in template/TSX-page props — not a separate, unrelated object in any of them.

`ContentApi`'s real shape, once you're somewhere it's actually reachable:

```ts
// pages() is SYNCHRONOUS — returns lightweight PageIndex[], not full Page
// objects (no rendered HTML). No "type" filter exists at all.
const recent = bootstrap.contentApi.pages({
  taxonomy: { name: "category", value: "technical" }, // one name+value pair, not a map
  language: "en",
  orderBy: "date",      // "date" | "title" | "order" — not an arbitrary frontmatter field
  orderDir: "desc",     // separate field from orderBy — default "asc"
  limit: 10,
});

// page(route) is ASYNC — resolves ONE page with rendered HTML, unlike pages()
const page = await bootstrap.contentApi.page("/blog/hello-world"); // ResolvedPage | null, not "findOne"

// Full-text search (requires the search index to have been built)
const results = await bootstrap.contentApi.search("deno fresh routing", { limit: 10 });

// List taxonomy terms
const categories = bootstrap.contentApi.taxonomy("category"); // not getTaxonomyValues()
```

There is no folder-`type` concept anywhere in this system — if you want "all posts in `02.blog/`", filter by `sourcePath.startsWith("02.blog/")` yourself against whichever `PageIndex[]` you have access to, same pattern used in the `dune-jobs` and `dune-email` skills' digest examples.

---

## Taxonomy

Taxonomy values are aggregated across all pages automatically. No schema definition required — any frontmatter field used as a taxonomy just needs to be listed in `site.yaml`, as a bare top-level key (`SiteConfig.taxonomies`) — **not** nested under a `content:` block:

```yaml
# site.yaml
taxonomies:
  - tags
  - category
```

Access taxonomy values via `.taxonomy(name)` and filter pages with `.pages({ taxonomy: { name, value } })` on the `ContentApi` — see "Querying content" below for where that's reachable from in your specific context (`bootstrap.contentApi`, hooks' `ctx.content`, or jobs' `ctx.contentApi`) and the real method names/shapes; there is no `getTaxonomyValues()` or `find()`.

---

## Language variants

```
content/02.blog/
  hello-world.md         → /blog/hello-world  (default language)
  hello-world.de.md      → /de/blog/hello-world
  hello-world.fr.md      → /fr/blog/hello-world
```

Language must be listed to be detected — but in a **different config file** than `site.yaml`: `config/system.yaml`, under `languages:` (not `i18n:`), with fields `supported`/`default` (not `languages`/`defaultLanguage`):

```yaml
# config/system.yaml
languages:
  supported: [en, de, fr]
  default: en
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

**If you're an agent with the Dune MCP server connected, prefer that over any of the HTTP curl workflows below.** `dune mcp:serve` registers `get_page_source`, `write_page`, `update_frontmatter`, and `list_blueprints` as direct MCP tools — no HTTP server, no auth token, no session cookie required. See the `dune-mcp` skill for the full tool list. Everything below is the fallback for when you're scripting against a running server instead.

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

### The HTTP admin API uses session cookies, not Bearer tokens

**There is no `Authorization: Bearer` support anywhere in the admin API.** `plugin-admin`'s auth middleware (`src/admin/auth/middleware.ts`) reads a session ID from the `Cookie` header only — it never looks at `Authorization` at all. A curl request with a Bearer token gets exactly the same response as one with no auth header: `401 { error: "No session cookie" }`. Log in first and reuse the cookie:

```sh
# 1. Log in — POST /admin/login, form-encoded (not JSON), save the session cookie
curl -c cookies.txt -X POST "http://localhost:3000/admin/login" \
  --data-urlencode "username=admin" --data-urlencode "password=$ADMIN_PASSWORD"

# 2. Reuse that cookie on every subsequent request
curl -b cookies.txt "http://localhost:3000/admin/api/page-source?route=/blog/my-post"
```

### Read a page's current source

```sh
curl -b cookies.txt "http://localhost:3000/admin/api/page-source?route=/blog/my-post"
# Returns: { route, sourcePath, format, content, frontmatter, body, mtime }
```

### Preview rendered output
Validate how content will render before writing it:

```sh
curl -b cookies.txt -X POST -H "Content-Type: application/json" \
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

**`template:` in frontmatter must match an actual file in the active theme.** `template: fancy` requires `themes/<active>/templates/fancy.tsx` to exist. `dune validate` catches this before the server starts.

**TSX content pages require trusted authors.** They run with full Deno permissions — no sandbox. Do not allow untrusted users to create `.tsx` content files. Use Markdown or MDX for user-generated content.

**Language code must be configured to be detected.** `post.de.md` is not treated as a German variant unless `de` is listed in `config/system.yaml` under `languages.supported` — a different file and key than you might expect (not `site.yaml`, not `i18n:`; see "Language variants" above). Without that config, the filename is treated as a slug containing a literal dot — producing an unexpected route.

**`draft: true` behaves differently in dev vs production.** Draft pages are excluded from the content index in production but visible in development. Don't rely on draft status as a security gate — use `roles:` frontmatter for access control.

**Two adjacent lists with the same marker merge into one.** This is standard CommonMark behavior (shared by every compliant Markdown/MDX parser, not a Dune quirk): a blank line alone does not end a list, so
```
1. Apple
2. Banana

1. Cherry
2. Date
```
renders as a single four-item list (`1. Apple / 2. Banana / 3. Cherry / 4. Date`), not two separate two-item lists. To force a real break, put a thematic break (`---`) between them — that's the standard, portable technique, not a Dune-specific workaround.

**GFM tables/strikethrough/task lists work in both Markdown and MDX.** `.md` pages get GFM via `marked`'s defaults. `.mdx` pages get it via `remarkGfm` passed to the MDX compiler.

**`dune content:list`/`content:check` only parse frontmatter — they never catch a page that fails to compile.** Indexing succeeding ("125 pages indexed") only means 125 files had valid YAML frontmatter; it says nothing about whether the body compiles. Run `dune content:check --render` (or `dune build`, which detects and reports the same failures) to actually compile every `.md`/`.mdx` body and catch MDX errors before they reach production.

**The content query API is not `@dune/content` — it's `@dune/core/content`.** There is no `@dune/content` package at all; every import in this file that references content/template types uses the `@dune/core` subpath.

**There is no `ctx.content.find()`/`findOne()` anywhere, and `ctx.content`/`props.content` isn't reliably present or consistently-shaped across hooks, jobs, and TSX templates.** See "Querying content" above — hooks' `ctx.content` can be `undefined` depending on timing, jobs get a guaranteed-present `ctx.contentApi` alongside the unrelated `ctx.content` (the raw engine), and templates/TSX pages get `content` populated on every normal render but it's still optional on the type (a couple of edge-case fallback paths omit it). The real method names (`pages()`/`page()`/`search()`/`taxonomy()`) don't match what you'd guess from other CMSes either way.

**`TemplateProps.page` has no `.title`.** Use `page.frontmatter.title`. `Page` has no top-level `title` field at all — and there is no `PageMeta` type in the real source; it's just `Page`.

**`ContentPageProps` (TSX content pages) has no `page` or `frontmatter` field.** Only `site`, `config`, `route`, `media`, `params`, and an optional `collection`. If you need the page's own frontmatter inside a TSX content page, query for it yourself — it isn't handed to you.

**The admin HTTP API (`page-source`, `render-markdown`, `dev/apply`) authenticates via session cookie, never a Bearer token.** `Authorization: Bearer ...` is silently ignored — `POST /admin/login` (form-encoded username/password) is the real way in, then reuse the `Set-Cookie` value on subsequent requests. If you're an MCP-connected agent, skip this whole HTTP path — `get_page_source`/`write_page`/`update_frontmatter` need no auth at all (see `dune-mcp`).
