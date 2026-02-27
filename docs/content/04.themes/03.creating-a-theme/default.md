---
title: "Creating a Theme"
published: true
visible: true
taxonomy:
  audience: [developer]
  difficulty: [intermediate]
  topic: [themes, development]
metadata:
  description: "Step-by-step guide to creating a custom Dune theme from scratch"
---

# Creating a Theme

This guide walks through building a minimal theme from scratch, then extending it with layouts, components, and MDX support.

## 1. Create the directory structure

```
themes/
└── my-theme/
    ├── theme.yaml
    └── templates/
        └── default.tsx
```

That's the minimum viable theme — a manifest and one template.

## 2. Write the manifest

`themes/my-theme/theme.yaml`:
```yaml
name: my-theme
version: 1.0.0
description: "My custom theme"
author: "Your Name"
```

All fields except `name` are optional. Set `parent: default` to inherit templates from another theme (see [Theme Inheritance](/themes/inheritance)).

## 3. Write your first template

`themes/my-theme/templates/default.tsx`:
```tsx
import type { TemplateProps } from "dune/types";

export default function DefaultTemplate({ page, children, site }: TemplateProps) {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{page.frontmatter.title} | {site.title}</title>
      </head>
      <body>
        <main>
          <h1>{page.frontmatter.title}</h1>
          <div dangerouslySetInnerHTML={{ __html: await page.html() }} />
        </main>
      </body>
    </html>
  );
}
```

`children` contains the pre-rendered page HTML as a JSX element. You can also call `await page.html()` directly if you need the raw string.

## 4. Activate the theme

In `config/site.yaml` (via your site's system config or `dune.config.ts`):

```yaml
# dune.config.ts
export default {
  theme: {
    name: "my-theme",
  },
};
```

Run `dune dev` — your theme is active.

## 5. Add a layout component

Extract shared HTML into a layout to avoid repetition across templates:

`themes/my-theme/components/layout.tsx`:
```tsx
import type { TemplateProps } from "dune/types";
import type { ComponentChildren } from "preact";

interface LayoutProps extends Omit<TemplateProps, "children"> {
  children: ComponentChildren;
}

export default function Layout({ page, site, children }: LayoutProps) {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{page.frontmatter.title} | {site.title}</title>
        <link rel="stylesheet" href="/theme/styles.css" />
      </head>
      <body>
        <header>
          <a href="/">{site.title}</a>
        </header>
        <main>{children}</main>
        <footer>
          <p>&copy; {new Date().getFullYear()} {site.title}</p>
        </footer>
      </body>
    </html>
  );
}
```

Then use it in templates via the `Layout` prop (loaded dynamically for hot-reload) with a static import as fallback:

```tsx
import type { TemplateProps } from "dune/types";
import StaticLayout from "../components/layout.tsx";

export default function DefaultTemplate({ page, site, config, nav, Layout, children }: TemplateProps) {
  // Layout prop is reloaded on each request in dev mode — prefer it over the static import
  const LayoutComponent = Layout ?? StaticLayout;
  return (
    <LayoutComponent page={page} site={site} config={config} nav={nav}>
      {children}
    </LayoutComponent>
  );
}
```

> **Hot-reload note**: Always use `Layout ?? StaticLayout` — never import layout directly as the only option. Direct imports are module-cached and won't reflect changes during development. Dune logs a warning if it detects a static-only layout import in a template.

## 6. Add static assets

Place CSS, fonts, and other static files in `themes/my-theme/static/`. They're served under `/theme/`:

```
themes/my-theme/static/styles.css  →  GET /theme/styles.css
themes/my-theme/static/fonts/Inter.woff2  →  GET /theme/fonts/Inter.woff2
```

## 7. Add a navigation component

Access the `nav` prop (top-level pages) to render a site navigation:

```tsx
// In your layout:
<nav>
  {nav.map((item) => (
    <a key={item.route} href={item.route}>{item.navTitle}</a>
  ))}
</nav>
```

`item.navTitle` uses the page's `nav_title` frontmatter field if set, falling back to `title`.

## 8. Add MDX component support (optional)

If your site uses `.mdx` content files and you want custom components available inside them, create `themes/my-theme/mdx-components.ts`:

```ts
// themes/my-theme/mdx-components.ts
import { Alert } from "./components/Alert.tsx";
import { Callout } from "./components/Callout.tsx";

export default { Alert, Callout };
```

Dune loads this file automatically at startup. See [MDX Content](/extending/mdx-content) for details.

## 9. Add a collection template

For listing pages (blog index, docs index, etc.), use the `collection` prop:

```tsx
// themes/my-theme/templates/blog.tsx
import type { TemplateProps } from "dune/types";
import StaticLayout from "../components/layout.tsx";

export default function BlogTemplate({ page, site, config, nav, Layout, collection, children }: TemplateProps) {
  const LayoutComponent = Layout ?? StaticLayout;
  return (
    <LayoutComponent page={page} site={site} config={config} nav={nav}>
      <h1>{page.frontmatter.title}</h1>
      {children}
      <ul>
        {collection?.items.map((post) => (
          <li key={post.route}>
            <a href={post.route}>{post.frontmatter.title}</a>
            {post.frontmatter.date && <time>{post.frontmatter.date}</time>}
          </li>
        ))}
      </ul>
      {collection?.hasNext && (
        <a href={`${page.route}/page:${(collection.page ?? 1) + 1}`}>Older →</a>
      )}
    </LayoutComponent>
  );
}
```

The content file controls collection query settings via frontmatter — the template just renders whatever `collection` contains.

## Theme development tips

- **Run `dune dev`** — templates reload automatically on file change; no restart needed
- **`theme.custom` config** — pass theme-specific settings via `config.theme.custom` (type-unsafe; validate in your template)
- **Error template** — add `templates/error.tsx` to customize 404 and 500 pages; it receives `{ statusCode, message }` in frontmatter
- **Watch the console** — Dune logs warnings for static layout imports and MDX load failures during startup
