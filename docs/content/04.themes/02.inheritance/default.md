---
title: "Theme Inheritance"
published: true
visible: true
taxonomy:
  audience: [developer]
  difficulty: [advanced]
  topic: [themes]
metadata:
  description: "Extending themes with inheritance"
---

# Theme Inheritance

Dune supports theme inheritance — a child theme can extend a parent theme, overriding only the templates and assets it needs to change.

## How it works

Declare a parent in your theme manifest:

```yaml
# themes/my-theme/theme.yaml
name: my-theme
version: 1.0.0
parent: default     # inherits from themes/default/
```

## Resolution order

When Dune looks for a template, it checks:

1. **Child theme** `templates/` directory
2. **Parent theme** `templates/` directory
3. Error if not found in either

This means:
- Override `post.tsx` in your child theme, and all posts use your version
- Leave `default.tsx` alone, and the parent's version is used
- You only customize what you need

## Example

Parent theme (`themes/default/`):
```
templates/
├── default.tsx     ← used for default.md pages
├── post.tsx        ← used for post.md pages
├── blog.tsx        ← used for blog listing
└── error.tsx       ← 404 page
```

Child theme (`themes/my-theme/`):
```
templates/
├── post.tsx        ← overrides parent's post template
└── landing.tsx     ← adds a new template type
```

Result:
- `default.md` → parent's `default.tsx` (not overridden)
- `post.md` → child's `post.tsx` (overridden)
- `blog.md` → parent's `blog.tsx` (not overridden)
- Pages with `template: landing` → child's `landing.tsx` (new)

## Static assets

Static assets also follow the inheritance chain. If your child theme provides `static/styles.css`, it overrides the parent's. If it doesn't, the parent's is served.

## Practical use cases

**Branding customization.** Start from a well-tested base theme, override just the layout and styles.

**Template additions.** Add new content types (portfolio, gallery, documentation) without duplicating the base templates.

**Seasonal variants.** Create holiday themes that override just the header and color scheme.
