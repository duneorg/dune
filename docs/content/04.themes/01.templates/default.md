---
title: "Templates"
published: true
visible: true
taxonomy:
  audience: [developer]
  difficulty: [intermediate]
  topic: [themes, templates]
metadata:
  description: "Writing JSX/TSX templates for Dune themes"
---

# Templates

Templates are JSX/TSX components that receive a page object and render it. Each content file maps to a template by filename convention.

## Template props

Every template receives `TemplateProps`:

```tsx
import type { TemplateProps } from "dune/types";
import StaticLayout from "../components/layout.tsx";

export default function PostTemplate({ page, pageTitle, site, config, nav, Layout, children }: TemplateProps) {
  const LayoutComponent = Layout ?? StaticLayout;
  return (
    <LayoutComponent site={site} config={config} nav={nav} page={page} pageTitle={pageTitle}>
      <article>
        <h1>{page.frontmatter.title}</h1>

        <time datetime={page.frontmatter.date}>
          {new Date(page.frontmatter.date).toLocaleDateString()}
        </time>

        <div>{children}</div>

        {page.frontmatter.taxonomy?.tag?.map((tag) => (
          <a key={tag} href={`/tag/${tag}`}>{tag}</a>
        ))}
      </article>
    </LayoutComponent>
  );
}
```

### What's in `TemplateProps`

| Prop | Type | Description |
|------|------|-------------|
| `page` | `Page` | The full page object (frontmatter, content, media, relations) |
| `pageTitle` | `string` | Pre-formatted title: "Title - Descriptor \| Site Name" |
| `site` | `SiteConfig` | Site configuration (title, URL, metadata) |
| `config` | `DuneConfig` | Full merged configuration |
| `nav` | `PageIndex[]` | Top-level navigation pages |
| `Layout` | `Component?` | Dynamically loaded layout component (see below) |
| `collection` | `Collection?` | Collection results if page defines one |
| `children` | `Element?` | Pre-rendered content (HTML wrapped in a div) |

### Using the Layout prop

The router passes a `Layout` prop that is loaded dynamically on each request. This ensures layout changes take effect during development without restarting the server. Templates should prefer the `Layout` prop over a static import:

```tsx
import StaticLayout from "../components/layout.tsx";

export default function MyTemplate({ Layout, ...props }: TemplateProps) {
  // Layout prop is fresh on every request; StaticLayout is the build-time fallback
  const LayoutComponent = Layout ?? StaticLayout;
  return (
    <LayoutComponent {...props}>
      {/* content */}
    </LayoutComponent>
  );
}
```

If a template only uses `import Layout from "../components/layout.tsx"` directly, layout file changes won't appear until the server restarts. Dune logs a warning when it detects this pattern during development.

### What's in `Page`

| Property | Type | Description |
|----------|------|-------------|
| `page.frontmatter` | `PageFrontmatter` | All frontmatter fields |
| `page.route` | `string` | URL path: `/blog/hello-world` |
| `page.format` | `ContentFormat` | `"md"`, `"tsx"`, or `"mdx"` |
| `page.template` | `string` | Template name: `"post"` |
| `page.media` | `MediaFile[]` | Co-located media files |
| `page.html()` | `Promise<string>` | Rendered HTML (Markdown pages) |
| `page.summary()` | `Promise<string>` | Auto-generated excerpt |
| `page.children()` | `Promise<Page[]>` | Child pages |
| `page.parent()` | `Promise<Page\|null>` | Parent page |
| `page.siblings()` | `Promise<Page[]>` | Sibling pages |

Note: `html()`, `children()`, `parent()`, and `siblings()` are lazy — they only load data when called.

## Template naming convention

| Content file | Template used |
|-------------|---------------|
| `default.md` | `templates/default.tsx` |
| `post.md` | `templates/post.tsx` |
| `blog.md` | `templates/blog.tsx` |
| `item.md` | `templates/item.tsx` |

Override with the `template` frontmatter field:

```yaml
template: landing   # uses templates/landing.tsx instead
```

## Blog listing template example

```tsx
import StaticLayout from "../components/layout.tsx";

export default function BlogTemplate({ page, pageTitle, site, config, nav, Layout, collection, children }: TemplateProps) {
  const LayoutComponent = Layout ?? StaticLayout;
  return (
    <LayoutComponent site={site} config={config} nav={nav} page={page} pageTitle={pageTitle}>
      <h1>{page.frontmatter.title}</h1>

      <div>{children}</div>

      {collection && (
        <ul>
          {collection.items.map((post) => (
            <li key={post.route}>
              <a href={post.route}>
                <h2>{post.frontmatter.title}</h2>
                <time>{post.frontmatter.date}</time>
              </a>
            </li>
          ))}
        </ul>
      )}

      {collection?.hasNext && (
        <a href={`${page.route}/page:${collection.page + 1}`}>
          Older posts →
        </a>
      )}
    </LayoutComponent>
  );
}
```
