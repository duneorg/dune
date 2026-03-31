---
title: "Visual Page Builder"
published: true
visible: true
taxonomy:
  audience: [editor, webmaster, developer]
  difficulty: [beginner]
  topic: [content, page-builder]
metadata:
  description: "Build landing pages and marketing content by composing pre-built sections — no code required"
---

# Visual Page Builder

The Visual Page Builder lets you compose pages from a library of pre-built sections — hero banners, feature grids, testimonials, pricing tables, and more. Changes are saved back to the page's frontmatter as a `sections:` array, so the output is plain files like everything else in Dune.

## When to use it

| Use the Page Builder | Use the block editor or TSX |
|---|---|
| Landing pages, marketing pages | Blog posts, documentation |
| Pages composed of distinct visual sections | Long-form prose content |
| Editors with no coding knowledge | Developers building custom layouts |
| Drag-and-drop section reordering | Fine-grained markdown formatting |

## Opening the builder

From any page in the admin panel, click **Builder** in the toolbar. The builder opens at `/admin/pages/builder?path=…`.

To return to the classic block editor, click **Classic Editor** in the builder toolbar.

## Builder UI

```
┌──────────────────────────────────────────────────────────────┐
│  ← Pages   Classic Editor   [page title]   🖥 📱 📲   Save  │
├────────────┬──────────────────────────────────┬──────────────┤
│ Sections   │  Canvas                          │ Page Settings│
│            │                                  │              │
│ 🚀 Hero    │  ┌─────────────────────────┐    │ Title        │
│ ✨ Features│  │ 🚀 Hero  #sec_abc  ▾ ↑↓⧉✕│    │ Slug         │
│ 💬 Testim. │  │   Headline              │    │ Date         │
│ 📣 CTA     │  │   Subtext               │    │ ☑ Published  │
│  …         │  │   CTA                   │    │              │
│            │  └─────────────────────────┘    │              │
│            │  ┌─────────────────────────┐    │              │
│            │  │ ✨ Features  #sec_def  ▾│    │              │
└────────────┴──────────────────────────────────┴──────────────┘
```

**Left panel — Section palette.** All available section types. Click a type to append it to the canvas, or drag it onto the canvas.

**Center — Canvas.** Your current sections in order. Each card shows the section type, its ID, and its fields when expanded. Use the arrow buttons (↑↓) to reorder, ⧉ to duplicate, ✕ to remove.

**Right panel — Page settings.** Title, slug, date, and published state for the page itself.

**Toolbar.** The preview buttons (🖥 📱 📲) resize the canvas to simulate desktop, tablet (768 px), and mobile (390 px) viewport widths.

## Built-in sections

### 🚀 Hero

Full-width headline with optional subtext, background, and up to two CTA buttons.

| Field | Type | Description |
|---|---|---|
| Headline | text | Main heading (required) |
| Subtext | textarea | Supporting paragraph |
| Primary CTA Label | text | Button text |
| Primary CTA URL | url | Button destination |
| Secondary CTA Label | text | Second button (optional) |
| Secondary CTA URL | url | Second button destination |
| Background | select | `light` / `dark` / `brand` |
| Background image URL | image | Optional full-bleed image |

### ✨ Features

Icon + title + description cards in a responsive grid.

| Field | Type | Description |
|---|---|---|
| Section Title | text | Heading above the grid |
| Subtitle | textarea | Optional sub-heading |
| Columns | select | 2 / 3 / 4 |
| Features | list | Repeating items: icon (emoji), title, description |

### 💬 Testimonials

Customer quotes with author attribution.

| Field | Type | Description |
|---|---|---|
| Section Title | text | Heading above the quotes |
| Testimonials | list | Repeating items: quote, author, role, company, avatar URL |

### 📣 Call to Action

Prominent band with headline, subtext, and a button.

| Field | Type | Description |
|---|---|---|
| Headline | text | Required |
| Subtext | textarea | Supporting copy |
| Button Label | text | Required |
| Button URL | url | Required |
| Background | select | `light` / `dark` / `brand` |

### 🖼️ Gallery

Image grid with optional captions.

| Field | Type | Description |
|---|---|---|
| Section Title | text | Optional heading |
| Columns | select | 2 / 3 / 4 |
| Images | list | Repeating items: image URL, caption, alt text |

### 💰 Pricing

Side-by-side pricing plan cards.

| Field | Type | Description |
|---|---|---|
| Section Title | text | e.g. "Simple Pricing" |
| Subtitle | textarea | e.g. "No hidden fees" |
| Plans | list | Repeating items: name, price, period, features (one per line), CTA label, CTA URL, highlighted (toggle) |

The plan with **highlighted** checked gets a "Popular" badge and an accent border.

### ❓ FAQ

Accordion of questions and answers.

| Field | Type | Description |
|---|---|---|
| Section Title | text | e.g. "Frequently Asked Questions" |
| Questions | list | Repeating items: question, answer |

FAQ items are collapsible on the rendered page — click the `+` to expand.

### 📝 Rich Text

Free-form HTML block. Useful for content that doesn't fit other section types.

| Field | Type | Description |
|---|---|---|
| Content | richtext | Raw HTML (required) |
| Width | select | `narrow` (640 px) / `normal` (800 px) / `wide` (full) |

### ⬛ Columns

Two or three equal-width columns of HTML content.

| Field | Type | Description |
|---|---|---|
| Column count | select | 2 or 3 |
| Column 1 | richtext | HTML for first column |
| Column 2 | richtext | HTML for second column |
| Column 3 | richtext | HTML for third column (3-col only) |

### 📬 Contact Info

Contact details with optional CTA button.

| Field | Type | Description |
|---|---|---|
| Section Title | text | e.g. "Get in Touch" |
| Intro text | textarea | Optional paragraph |
| Email address | text | Shown with ✉️ icon |
| Phone number | text | Shown with 📞 icon |
| Address | textarea | Multi-line, shown with 📍 icon |
| Button Label | text | Optional CTA |
| Button URL | url | Optional CTA destination |

## How data is stored

The page file is a standard Dune markdown file. The builder writes `layout: "page-builder"` and a `sections:` array into the frontmatter:

```yaml
---
title: "Product Landing Page"
layout: "page-builder"
published: true
sections:
  - id: sec_a1b2c3
    type: hero
    headline: "Ship faster with Dune"
    subtext: "The flat-file CMS built for developers and editors."
    cta_text: "Get Started"
    cta_url: "/getting-started"
    cta2_text: "View Demo"
    cta2_url: "/demo"
    background: dark

  - id: sec_d4e5f6
    type: features
    title: "Why Dune"
    columns: "3"
    items:
      - icon: "⚡"
        title: "Fast"
        description: "Sub-50 ms page delivery with built-in caching."
      - icon: "🔌"
        title: "Extensible"
        description: "Plugins, hooks, and a clean TypeScript API."
      - icon: "✍️"
        title: "Editor-friendly"
        description: "Block editor and visual page builder included."
---
```

You can edit this YAML directly in the Classic Editor if needed. The builder reads whatever is in the file when you open it.

## Rendering

When Dune serves a page with `layout: "page-builder"`, the routing layer calls `renderSections()` instead of rendering the markdown body. The output is self-contained HTML with embedded styles — it works without any special theme support.

Theme templates receive the sections HTML as their `children` prop, exactly like normal markdown content. The sections use CSS class names prefixed with `pb-` that themes can override for custom styling.

## Custom sections (developer)

Custom section types can be registered at startup by calling `sectionRegistry.register(def)` from a plugin:

```typescript
import { sectionRegistry } from "dune/sections";

sectionRegistry.register({
  type: "banner",
  label: "Announcement Banner",
  icon: "📢",
  description: "Highlighted message strip",
  fields: [
    { id: "message", type: "text", label: "Message", required: true },
    { id: "link_text", type: "text", label: "Link text" },
    { id: "link_url", type: "url", label: "Link URL" },
    {
      id: "color",
      type: "select",
      label: "Color",
      default: "blue",
      options: [
        { value: "blue", label: "Blue" },
        { value: "yellow", label: "Yellow" },
        { value: "red", label: "Red" },
      ],
    },
  ],
});
```

The new section type appears immediately in the builder palette. To control how it renders, add a case to a custom renderer or extend the built-in renderer in a plugin.

## Tips

- **Reorder quickly:** Use the ↑↓ buttons on each card or drag cards to a new position.
- **Duplicate a section:** Click ⧉ to copy a section with all its field values — useful for similar pricing plans or repeated feature blocks.
- **Collapse cards:** Click a card header to collapse it once you're done editing its fields. This keeps the canvas tidy on long pages.
- **Preview at breakpoints:** Use the 🖥 📱 📲 toolbar buttons to check your layout at different widths before saving.
- **Mix with classic content:** Pages that use the builder have an empty markdown body. If you switch back to the Classic Editor, the `sections:` frontmatter is preserved and you can edit it as YAML.
