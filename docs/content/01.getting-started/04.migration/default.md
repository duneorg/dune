---
title: "Migrating to Dune"
published: true
visible: true
taxonomy:
  audience: [webmaster, developer]
  difficulty: [beginner]
  topic: [migration, cli]
metadata:
  description: "Import content from Grav, WordPress, Hugo, or a folder of markdown files using the built-in migration commands"
---

# Migrating to Dune

Dune ships four migration commands for importing content from other platforms. They read your existing content, convert it to Dune's folder-based structure, and write the result into your site's `content/` directory. Your original files are never modified.

```
dune migrate:from-grav <src>
dune migrate:from-wordpress <src>
dune migrate:from-markdown <src>
dune migrate:from-hugo <src>
```

## Common options

All four commands accept the same set of options:

| Option | Default | Description |
|---|---|---|
| `--out <dir>` | `content/` | Write imported content to a different directory |
| `--dry-run` | off | Print what would be created without writing any files |
| `--verbose` | off | Print each file as it is processed |
| `--root <dir>` | `.` | Dune site root (if running from outside the site directory) |

Always do a **dry run** first and review the output before writing files to your live content directory.

---

## Migrating from Grav

Grav uses nearly the same folder + frontmatter structure as Dune, so this migration is the simplest. Content files, numeric folder prefixes, co-located media, and taxonomy are all preserved as-is. Grav-specific fields (`process`, `access`, `sitemap`) are silently dropped.

```
dune migrate:from-grav /path/to/grav-site
```

Point at either the full Grav installation directory or just its `user/pages/` subdirectory — the command auto-detects which you provided.

### What is preserved

| Grav field | Dune field | Notes |
|---|---|---|
| `title` | `title` | Direct |
| `date` | `date` | Direct |
| `published` | `published` | Direct |
| `visible` | `visible` | Direct |
| `routable` | `routable` | Direct |
| `slug` | `slug` | Direct |
| `template` | `template` | Direct |
| `taxonomy` | `taxonomy` | Direct |
| `metadata` | `metadata` | Direct |
| `routes.aliases` | `routes.aliases` | Direct |
| `header.image` | `image` | Promoted to top level |
| `header.author` | `custom.author` | Moved under `custom` |
| Media files | Media files | Copied unchanged |

### What is dropped

- `process` (Grav rendering flags)
- `access` (Grav ACL)
- `sitemap` (Grav sitemap config — Dune auto-generates sitemaps)
- `cache_control`, `never_cache` (replaced by Dune's cache config)

---

## Migrating from WordPress

Export your WordPress site via **Tools → Export** and choose "All content". This produces a WXR file (WordPress eXtended RSS, an XML format).

```
dune migrate:from-wordpress /path/to/export.xml
```

### What is imported

**Posts** are written into `content/01.blog/` with a `post.md` template, sorted by publish date and numbered sequentially. A `content/01.blog/default.md` listing page is created automatically if one does not exist.

**Pages** are written as top-level pages using the `default.md` template.

| WordPress field | Dune field |
|---|---|
| `post_title` | `title` |
| `post_name` (slug) | folder name |
| `post_date` | `date` |
| `post_status` | `published` (`publish` → `true`) |
| Category terms | `taxonomy.category` |
| Tag terms | `taxonomy.tag` |
| `content:encoded` | Markdown body (HTML passthrough) |

### Content format

WordPress content is HTML. Dune's markdown renderer passes raw HTML through unchanged, so your content will display correctly without conversion. If you want clean markdown, use a tool like [Pandoc](https://pandoc.org) on the individual files after migration.

### Not imported

- Comments (Dune has its own comment system — migrate manually if needed)
- Users (create admin users via `dune new` or the admin panel)
- Attachments / media (download your `wp-content/uploads/` separately and place files in the relevant `content/` page folders or a shared `static/` directory)
- Custom post types beyond `post` and `page`
- Plugin data (ACF fields, WooCommerce products, etc.)

---

## Migrating from a markdown folder

Import any flat or nested directory of `.md` files. This works for content exported from Notion, Obsidian, Bear, or any other tool that produces standard markdown files.

```
dune migrate:from-markdown /path/to/markdown-folder
```

### What happens

- Each `.md` file becomes a numbered folder (e.g. `01.my-post/default.md`)
- Existing YAML frontmatter is preserved as-is
- Files with no `title` get a title derived from the filename
- Files with no `published` field default to `published: true`
- All-uppercase files (`README.md`, `CHANGELOG.md`) are skipped
- Subdirectories are processed recursively, producing nested Dune folders
- Non-markdown files (images, PDFs) are copied alongside their markdown source

### Tips

- Run with `--dry-run --verbose` first to review the folder mapping before committing
- If your files have frontmatter, Dune will use it as-is — clean it up before or after migration
- Files without frontmatter get minimal Dune frontmatter auto-generated (title + published)

---

## Migrating from Hugo

Point at the root of your Hugo site. The command reads from `content/` and copies `static/` assets.

```
dune migrate:from-hugo /path/to/hugo-site
```

### Frontmatter mapping

Hugo supports YAML (`---`), TOML (`+++`), and JSON (`{}`) frontmatter — all three are handled.

| Hugo field | Dune field | Notes |
|---|---|---|
| `title` | `title` | Direct |
| `date` / `publishDate` | `date` | ISO date, time part stripped |
| `draft: true` | `published: false` | Inverted |
| `slug` | `slug` | Direct |
| `tags` | `taxonomy.tag` | |
| `categories` | `taxonomy.category` | |
| `aliases` | `routes.aliases` | |
| `description` / `summary` | `metadata.description` | |
| `author` / `authors` | `custom.author` | |
| `weight` | `order` | Used for nav ordering |

### Section index pages

Hugo's `_index.md` section index files are renamed to `default.md` — the Dune equivalent.

### Static assets

Files in Hugo's `static/` directory are copied to `static/` in your Dune site root (creating it if needed). Reference them in content as `/filename.ext`.

### Not imported

- Hugo layouts and partials (Dune uses its own theme system — see [Themes](/themes))
- Hugo shortcodes (convert to plain HTML or Dune's block system manually)
- Hugo data files (`data/` directory)
- Hugo `config.toml` / `config.yaml` (recreate your settings in Dune's `site.yaml`)

---

## After migration

Once the import is complete:

1. **Start the dev server** to preview your content: `dune dev`
2. **Check for issues**: `dune content:check` reports missing titles, broken internal links, and missing templates
3. **Assign templates**: Dune looks for a theme template matching each page's filename (e.g. `post.md` → `post.tsx`). Add any missing templates to your theme or update the `template:` frontmatter field
4. **Review taxonomy**: Run `dune content:list` to see all pages and their published state
5. **Handle media**: For WordPress imports, download your media files and place them in the appropriate `content/` page folders

## Example workflow

```sh
# 1. Dry run to see what will be created
dune migrate:from-hugo ~/old-blog --dry-run --verbose

# 2. Run the actual migration
dune migrate:from-hugo ~/old-blog

# 3. Check for problems
dune content:check

# 4. Start the dev server and review
dune dev
```
