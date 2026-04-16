# Changelog

All notable changes to Dune CMS are documented here.
This project follows [Semantic Versioning](https://semver.org). Pre-1.0 minor releases may include breaking changes per semver convention. Stable API guarantees begin at v1.0.0.

---

## [0.7.0] — 2026-04-16

### Breaking

- **Media URLs changed.** Co-located media is now served at route-equivalent paths with numeric prefixes stripped — `02.blog/01.post/cover.jpg` is served at `/blog/post/cover.jpg`. The old `/content-media/` prefix is still accepted by the dev and production servers for backward compatibility, but the SSG static build outputs files at the new paths only. Update any hardcoded `/content-media/` URLs in templates or content.

### Added

- **Flat-file pages.** Pages no longer require their own folder. A file named `01.my-post.md` inside a parent folder is treated as an ordered leaf page at `/parent/my-post`. Folders win on route collision.
- **`order` frontmatter field.** Set sort position explicitly without renaming files — `order: 3` in frontmatter overrides the numeric folder/filename prefix. Pages without a prefix and without `order` sort alphabetically after all explicitly-ordered pages.
- **`dune --version` / `-V`.** Prints version and install source (`jsr:@dune/core` or `source: /path/to/clone`) for easy diagnosis of local-vs-JSR mismatches.

### Fixed

- Multilingual page variants (`default.md`, `default.fr.md`, `default.de.md`) were incorrectly treated as route collisions and dropped from the index. They now correctly coexist as separate language variants of the same route.
- Contact form redirect failed behind a reverse proxy due to missing `X-Forwarded-Proto` header handling.
- Form handlers did not collect multi-value fields (e.g. checkboxes with the same name) — only the last value was kept.

---

## [0.6.0] — 2026-03-28

**Theme: Ready for everything.** Stable APIs, long-term support, general availability.

### Added

#### Visual Page Builder
- New `src/sections/` module: `SectionDef`, `SectionField`, `SectionInstance` types
- 10 built-in section types: hero, features, testimonials, CTA, gallery, pricing, FAQ, rich text, columns, contact
- `SectionRegistry` singleton (`sectionRegistry`) — register custom section types from plugins
- `renderSections()` — server-side HTML renderer with self-contained styles
- Admin: `GET /admin/pages/builder?path=` Visual Page Builder UI (drag-and-drop canvas, section palette, field editors, desktop/tablet/mobile preview)
- Admin: `GET /admin/api/sections` — section library JSON endpoint
- Routing: pages with `layout: "page-builder"` are rendered via `renderSections()` instead of markdown
- Classic page editor now has a **Builder** toolbar button

#### Migration Tools (CLI)
- `dune migrate:from-grav <src>` — import a Grav site preserving folder structure, frontmatter, and media
- `dune migrate:from-wordpress <src>` — import a WordPress WXR export (posts, pages, categories, tags)
- `dune migrate:from-markdown <src>` — import any flat/nested markdown folder
- `dune migrate:from-hugo <src>` — import a Hugo site (YAML/TOML/JSON frontmatter, static assets)
- All migration commands support `--dry-run`, `--verbose`, `--out <dir>`

#### Marketplace
- Admin: `GET /admin/marketplace` — unified plugin + theme discovery page with Plugins/Themes tabs
- Admin: `GET /admin/api/registry/plugins` — bundled plugin registry JSON endpoint
- Admin: `POST /admin/api/plugins/install` — adds a JSR plugin entry to `config/site.yaml`
- Bundled plugin registry (`src/admin/registry/plugins.json`) — 10 first-party plugins with verified badges, download counts, hook lists, and JSR specifiers
- Bundled theme registry updated (`src/admin/registry/themes.json`) — 6 themes with verified badges and download counts
- Marketplace nav item added to Admin sidebar

#### API Stability
- **Version bumped to 0.6.0** — all public exports in `src/mod.ts` are now stable
- `PLUGIN_API_VERSION` updated to `"0.6"` in `@dune/core/plugins`
- Named JSR sub-module exports added: `@dune/core/plugins`, `@dune/core/sections`
- `DunePlugin`, `HookEvent`, `PluginApi` interfaces annotated `@since 0.1.0` / frozen since 0.6.0
- `SectionDef`, `SectionInstance`, `sectionRegistry`, `renderSections` added to public API

### Changed

- `PageFrontmatter` now includes `sections?: Array<{id, type, ...fields}>` (additive, no breaking change)

---

## [0.5.0] — 2026-03-28

### Added
- **Static Site Generation** — `dune build --static`; incremental builds; `--hybrid` edge deployment mode
- **Advanced Caching** — ETag/304, Cache-Control + SWR, in-process page cache with TTL + FIFO eviction (`src/cache/`)
- **Audit Logging** — append-only JSONL audit log; 15 event types; admin UI + API (`src/audit/`)
- **Performance Monitoring** — request latency percentiles (p50/p95/p99), slow query logging, memory stats; `/admin/metrics` dashboard (`src/metrics/`)
- **Multi-Stage Workflows** — configurable stages and role-based transitions in `site.yaml` (`src/workflow/`)
- **Machine Translation** — DeepL, Google Translate, LibreTranslate providers; `POST /admin/api/i18n/translate-page` (`src/mt/`)
- **RTL Language Support** — `isRtl()`, `directionOf()`; `TemplateProps.dir`; auto `dir="rtl"` injection; admin panel RTL mirroring (`src/i18n/rtl.ts`)
- **Pluggable Auth Provider** — `AuthProvider` interface; `LocalAuthProvider`; LDAP and SAML stubs (`src/admin/auth/provider.ts`)

---

## [0.4.0]

### Added
- Real-time collaboration — WebSocket OT-based concurrent editing, presence indicators, change attribution, auto-save (`src/collab/`)
- Advanced search — faceted filtering, autocomplete, search analytics
- Outbound webhooks — configurable per event type, delivery log with retry tracking
- Incoming webhooks — `POST /api/webhook/incoming`; token-auth with `$ENV_VAR` expansion; `rebuild` and `purge-cache` actions
- Internal comments — page-level threads with resolution status; block-anchored annotations; `@mention` notifications
- Multi-site management — `MultisiteManager`, hostname/path-prefix routing, shared themes, `@site.*` collection sources (`src/multisite/`)
- Media upload/delete — `POST /admin/api/media/upload`, `DELETE /admin/api/media`; upload UI in media library and page editor
- Block type picker — "Add Block" opens type menu; non-image media insert emits link block
- File-type pages — `file:` frontmatter → routing-layer redirect to co-located file; `fileUrl` on `PageIndex`

---

## [0.3.0]

### Added
- Theme SDK helpers — `paginate`, `formatDate`, `getCanonicalUrl`, `sortPages`, `groupByYear`, `truncate` (`src/theme-helpers/`)
- Live theme switching — `engine.switchTheme(name)`; persists to `site.yaml`; `onThemeSwitch` hook
- Theme configuration — `config_schema` in `theme.yaml`; `TemplateProps.themeConfig`; admin Theme tab
- Plugin auto-discovery — scans `plugins/` directory for `.ts` files
- Search UI — public `/search` route; debounced live JS search; theme-overridable via `"search"` template
- RSS/Atom feeds — `/feed.xml` (RSS 2.0) and `/atom.xml` (Atom 1.0); `site.feed` config
- XML sitemap enhancements — `exclude` patterns, per-route `changefreq`, `<image:image>` entries

---

## [0.2.0]

### Added
- MDX format handler (`src/content/formats/mdx.ts`)
- Image processing pipeline — resize, convert, cache; `sharp`-based; focal point support
- Admin panel — authentication, sessions, dashboard, block editor, media library
- Content workflow — draft/in_review/published/archived status
- Revision history with visual diff
- i18n translation status dashboard; side-by-side translation editing; Translation Memory
- Production hardening — security headers, gzip, cache headers, error pages, health endpoint
- Auto-generated XML sitemap

---

## [0.1.0]

### Added
- Core engine — content scanning, routing, rendering
- Markdown, TSX, MDX format handlers
- File system storage adapter
- Configuration system — YAML + defaults + validation
- Taxonomy system
- Collection engine (query language, pagination)
- Full-text search engine
- CLI — `new`, `dev`, `build`, `serve`
- Theme system — template loading, inheritance
- Plugin system — hook registry, lifecycle events

---

## Migration guide — v0.5 to v0.6

There are no breaking changes between v0.5 and v0.6. The `src/mod.ts` public
API is a strict superset of v0.5. If you import from `@dune/core` and your
code compiled against v0.5, it will compile against v0.6 without changes.

The only intentional change is **additive**:
- `PageFrontmatter.sections` is a new optional field.
- `@dune/core/sections` is a new sub-module export.
- `PLUGIN_API_VERSION` changed from `"0.3"` to `"0.6"`. If your plugin
  checks this value with a strict equality check, update it accordingly.
