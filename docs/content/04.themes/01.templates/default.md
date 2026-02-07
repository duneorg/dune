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

export default function PostTemplate({ page, site, config, collection }: TemplateProps) {
  return (
    <article>
      <h1>{page.frontmatter.title}</h1>

      <time datetime={page.frontmatter.date}>
        {new Date(page.frontmatter.date).toLocaleDateString()}
      </time>

      <div dangerouslySetInnerHTML={{ __html: await page.html() }} />

      {page.frontmatter.taxonomy?.tag?.map((tag) => (
        <a key={tag} href={`/tag/${tag}`}>{tag}</a>
      ))}
    </article>
  );
}
```

### What's in `TemplateProps`

| Prop | Type | Description |
|------|------|-------------|
| `page` | `Page` | The full page object (frontmatter, content, media, relations) |
| `site` | `SiteConfig` | Site configuration (title, URL, metadata) |
| `config` | `DuneConfig` | Full merged configuration |
| `collection` | `Collection?` | Collection results if page defines one |
| `children` | `JSX.Element?` | Child content (for layouts) |

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
export default function BlogTemplate({ page, collection }: TemplateProps) {
  return (
    <section>
      <h1>{page.frontmatter.title}</h1>

      <div dangerouslySetInnerHTML={{ __html: await page.html() }} />

      {collection && (
        <ul>
          {collection.items.map((post) => (
            <li key={post.route}>
              <a href={post.route}>
                <h2>{post.frontmatter.title}</h2>
                <time>{post.frontmatter.date}</time>
                <p>{await post.summary()}</p>
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
    </section>
  );
}
```
