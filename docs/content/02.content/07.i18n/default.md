---
title: "Multilingual Content (i18n)"
published: true
visible: true
taxonomy:
  audience: [editor, webmaster, developer]
  difficulty: [intermediate]
  topic: [content, i18n]
metadata:
  description: "Creating multilingual sites with Dune's i18n model"
---

# Multilingual Content

Dune supports multilingual sites through a filename-based translation model. Each language variant of a page is a separate file living in the same content folder.

## Enabling i18n

Add supported languages to `config/system.yaml`:

```yaml
languages:
  supported: ["en", "de", "fr"]
  default: "en"
  include_default_in_url: false   # /page (not /en/page) for the default language
```

Once `supported` contains more than one language, Dune activates multilingual routing.

## File naming convention

Create language variants by adding a language code before the file extension:

```
content/02.about/
├── default.md       # English (default language)
├── default.de.md    # German
└── default.fr.md    # French
```

The pattern is `{template}.{lang}.{ext}` where `{lang}` is one of the codes in `languages.supported`.

A `.tsx` content page cannot use the language suffix — use separate folders for TSX pages in different languages.

## URL structure

With `include_default_in_url: false` (the default):

| File | URL |
|------|-----|
| `default.md` | `/about` (English — no prefix) |
| `default.de.md` | `/de/about` |
| `default.fr.md` | `/fr/about` |

With `include_default_in_url: true`:

| File | URL |
|------|-----|
| `default.md` | `/en/about` |
| `default.de.md` | `/de/about` |
| `default.fr.md` | `/fr/about` |

The home page works the same way: `/de` serves the German home page.

## Language fallback

If a visitor requests `/de/about` but `default.de.md` doesn't exist, Dune serves the default-language version (`default.md`) rather than returning a 404.

## Internal links

Links written in Markdown content are automatically rewritten to include the current language prefix when rendering non-default-language pages.

For example, in a German page:
```markdown
[Contact us](/contact)
```

…is rewritten to:
```html
<a href="/de/contact">Contact us</a>
```

The following URL patterns are never rewritten: `/themes/`, `/content-media/`, `/api/`, `/admin/`.

## Navigation

Each language has its own navigation tree. Templates receive the current language's nav via the `nav` prop. Pages are filtered to only show content for the active language.

## Sitemap

The sitemap (`/sitemap.xml`) includes `xhtml:link` `hreflang` alternates for all multilingual pages, including an `x-default` entry pointing to the default-language version.

## Checking translation status

```bash
dune content:i18n-status
```

Reports translation coverage across all configured languages — which pages have translations, which are missing, and which are outdated (the default-language version has been updated since the translation was written).

## RTL languages

Dune automatically detects right-to-left languages (Arabic, Hebrew, Persian, Urdu, and others) and applies the correct `dir` attribute.

### Theme templates

The `TemplateProps` object passed to TSX templates includes a `dir` field:

```tsx
export default function Layout({ dir, title, content }: TemplateProps) {
  return (
    <html dir={dir} lang={props.page.language ?? "en"}>
      <head>...</head>
      <body>{content}</body>
    </html>
  );
}
```

`dir` is `"rtl"` for Arabic, Hebrew, Persian, Urdu, and similar languages; `"ltr"` for everything else.

### Automatic injection

If your theme template does not include a `dir` attribute on `<html>`, Dune injects it automatically on the server when serving RTL-language pages. This ensures correct text direction even with themes that predate RTL support.

### Admin panel

The admin panel mirrors its layout when the site's default language (or the language of the page being edited) is RTL:

- Sidebar shifts to the right side
- Text inputs are right-aligned
- Navigation items right-align
- Breadcrumbs reverse direction

### Extending the RTL language list

Add languages to the built-in RTL set via `system.yaml`:

```yaml
languages:
  supported: ["en", "ar", "ku-Latn"]
  default: "en"
  rtl_override: ["ku-Latn"]   # Force Kurdish Latin script to RTL (unusual, example only)
```

`rtl_override` entries are checked after the built-in list, so you can add rare scripts or regional variants not covered by the default detection.
