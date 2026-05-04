# Changelog

All notable changes to Dune CMS are documented here.
This project follows [Semantic Versioning](https://semver.org). Pre-1.0 minor releases may include breaking changes per semver convention. Stable API guarantees begin at v1.0.0.

---

## [0.8.2] — 2026-05-04

### Added

- **MDX co-located imports** — MDX files can now import components using relative paths co-located alongside the post file (`import Chart from './Chart.tsx'`). Relative imports are resolved server-side and merged into the MDX component scope alongside the theme registry. Co-located imports take precedence over registry components, so a post can override a theme-wide component for its own use. All three import forms are supported: default, named, and namespace.

- **Co-located iframe embeds with automatic height synchronisation** — Co-located `.html` files can be embedded as iframes using a relative `<iframe src="./file.html">` in content. Dune rewrites the src to an absolute URL, serves the file as `text/html`, and automatically injects scripts on both sides of the frame boundary so the iframe resizes to fit its content exactly — no fixed height needed. Multiple iframes on the same page resize independently. Requires `trusted_html: true` at page or site level.

### Fixed

- **Spurious route collision warnings** — When a route collision involves an unpublished page, Dune now silently prefers the published one without logging a warning. Eliminates false positives for intentional cases such as a `README.md` sitting alongside a `default.md` in a submodule.

---

## [0.8.1] — 2026-04-23

### Fixed

- **Preact import map** — the `preact/` trailing-slash catch-all entry has been removed from Dune's `deno.json`. `npm:` specifiers are not hierarchical URLs and esbuild's `@deno/loader` was failing to resolve subpath imports (e.g. `preact/hooks`) against the prefix. Explicit entries for `preact/hooks`, `preact/jsx-runtime`, and `preact/jsx-dev-runtime` cover all subpaths used internally and in theme islands.

### Internal

- `createProductionSiteHandler`, `createDevSiteContext`, and `buildSitePrebuilt` in `src/cli/site-handler.ts` are now marked deprecated. They remain in place for the multisite manager and SSG builder but are no longer used by the single-site `dune serve` and `dune dev` paths, which route through `createDuneApp()` instead.

---

## [0.8.0] — 2026-04-23

### Added

- **Island components** — themes can now place Preact components in `themes/{name}/islands/` and they will be automatically bundled with esbuild and hydrated client-side via Fresh's boot script. Any Preact hooks are available; props must be JSON-serialisable. In dev mode, Fresh watches the `islands/` directory and rebuilds the bundle on save without requiring a server restart.

- **`onRequest` hook now fires for request interception** — the `onRequest` lifecycle hook fires at the start of every request, before Dune's routing pipeline. Plugins can call `setData(response)` + `stopPropagation()` to short-circuit routing and return a custom response immediately — enabling custom API endpoints, auth guards, and per-request middleware without forking the serve command.

### Changed

- **Fresh-first architecture** — Fresh now owns the server and the full request lifecycle. Dune's routing, admin panel, API, feeds, static files, and plugin hooks are assembled as Fresh middleware via the new internal `createDuneApp()` factory. This supersedes the previous passthrough pattern and is a new foundation for island hydration. Behaviour is identical for site authors; `dune serve` and `dune dev` work as before.

### Fixed

- **Plugin loading with relative root** — `dune serve .` (or any relative root path) was constructing `file://plugins/api.ts` instead of `file:///abs/path/plugins/api.ts`, causing dynamic plugin imports to fail. Root is now resolved to an absolute path at bootstrap entry.

---

## [0.7.5] — 2026-04-22

### Changed

- **Fresh 2 render pipeline** — `dune serve` and `dune dev` now route HTML requests through a Fresh 2 `App` instance. Pages are rendered via `ctx.render()` instead of raw `preact-render-to-string`, so Fresh can inject its boot script and manage client-side hydration. This is the foundational step for island support.

  Non-HTML requests (API, admin, static assets, POST/PUT/DELETE) bypass Fresh and are handled directly by the Dune handler, so existing behaviour is unchanged.

  **For site authors**: no changes required. Sites serve and behave identically; the boot script added to HTML pages is a benign no-op until islands are registered.

  **For framework integrators** using `createProductionSiteHandler` or `createDevSiteContext` directly: both now return handlers typed `(req: Request, renderJsx?: RenderJsx) => Promise<Response>`. Pass a custom `renderJsx` (e.g. `ctx.render` from a Fresh route context) to override rendering per-request; omit it to use the default preact-render-to-string fallback.

- **`RenderJsx` type exported** from `@dune/core` (`src/cli/site-handler.ts`) — `(jsx: unknown, statusCode?: number) => Response | Promise<Response>`.

- **`DuneRoutes.contentHandler`** now accepts an async `renderJsx` (return type `Response | Promise<Response>`), enabling use of `ctx.render()` which is inherently async in Fresh 2.

---

## [0.7.4] — 2026-04-17

### Security

Full audit of new attack surface added since v1.0. No exploited issues; every finding below is defence in depth against author/editor-role compromise, hostile migration input, or cheap DoS. See `/Users/xrs/.claude/plans/it-s-time-to-once-buzzing-fog.md` for the findings matrix.

- **HTML sanitizer** (`src/security/sanitize-html.ts`) — hand-rolled tokenizer sanitiser with an allowlist of tags and per-tag attributes. Strips `<script>`, `<iframe>`, event handlers, `style`, and any attribute whose value contains `javascript:` / `data:text/html`. Applied to:
  - `renderText` and `renderColumns` in the page-builder sections renderer (fixes H1 — stored XSS via richtext section fields).
  - `MarkdownHandler.renderToHtml` (fixes H2 — marked v15 passes raw HTML through by default). Opt-out via `site.trusted_html: true` in `site.yaml` or `trusted_html: true` in a page's own frontmatter.
  - WordPress WXR importer in `src/cli/migrate.ts` (fixes H3 — imported post bodies were written unsanitised). Opt-out via `--trust-source`.
- **Fixed: `trusted_html` opt-out was silently ignored** — `ctx.site` was always `undefined` in the markdown renderer because `buildMinimalRenderContext` never received the site config, and per-page frontmatter was not read either. Fixed by threading `site?: SiteConfig` through `PageLoaderOptions` → engine → `buildMinimalRenderContext`, pre-resolving the flag as `trustedHtml?: boolean` on `RenderContext`, and checking `ctx.trustedHtml` in the renderer. Both `site.trusted_html` (site.yaml) and `trusted_html` (page frontmatter) now work correctly.
- **URL scheme allowlist** (`src/security/urls.ts`) — `isSafeUrl` / `safeUrl` accept only `http:`, `https:`, `mailto:`, `tel:`, anchor fragments, and relative paths. Rejects `javascript:`, `data:`, `vbscript:`, `file:`, tab/newline obfuscation, and leading whitespace. Applied to every CTA/image URL in page-builder sections and to marketplace repository/demo links (fixes H4).
- **Template name validation** — `ThemeLoader.loadTemplate` rejects any name that doesn't match `/^[a-zA-Z0-9_-]+$/` before using it in a path join. Frontmatter can no longer request `../../etc/passwd` (fixes M1).
- **CSP tightened** — admin `img-src` narrowed from `'self' data: blob: *` to `'self' data: blob: https:`. Rejects attacker-host `http://` exfil pixels (fixes M2).
- **Rate limiting on public API** — extracted the admin rate limiter into `src/security/rate-limit.ts` and applied a 120 req/min per-IP budget to `/api/search`, `/api/collections`, `/api/taxonomy/*`, `/api/pages`, `/api/flex/*`, and the `/search` page (fixes M3).
- **Audit log sharding** — `AuditLogger` rotates to `{runtimeDir}/audit/YYYY-MM-DD.jsonl`. Queries read only the shards within the requested date range instead of slurping the full file on every request. Legacy single-file logs continue to be read as a fallback so no history is lost on upgrade (fixes M4).
- **Password strength** — new `src/security/password-strength.ts` rejects a small blocklist of common passwords, single-character runs, and trivial sequential patterns in addition to the existing 12-char minimum. Applied to user create and password-change endpoints (fixes M5).
- **Metrics redaction** — slow-query strings are truncated to 80 characters before being stored, preventing arbitrarily long user-supplied search / filter text from surfacing on the admin metrics dashboard (fixes M6).
- **Plugin auto-discovery is opt-in** — `plugins/*.ts` are no longer auto-loaded unless `auto_discover_plugins: true` is set at the top level of `site.yaml`. Reduces blast radius of a rogue file dropped into the plugins directory (fixes L1).
- **Form-validator ReDoS guard** — blueprint `validate.pattern` patterns with nested quantifiers (`(x+)+`, `(x*)+`, etc.) are rejected at validation time, and the input length fed to `RegExp#test` is capped at 10 000 characters (fixes L2).
- **CORS misconfiguration warning** — the API layer emits a one-shot warning when `site.url` is missing or invalid and the origin is being reflected back, surfacing the misconfiguration (fixes L3).
- **Marketplace image URL validation** — plugin `iconUrl` and theme `screenshotUrl` are now accepted only when they resolve to `https:` (or protocol-relative); all other schemes are silently dropped (fixes L4).
- **Form upload hardening** — new `src/security/uploads.ts` gates form-submission file uploads behind a server-side extension allowlist (images, PDF, office docs, txt, csv, zip). The stored content-type is derived from the extension, discarding the attacker-controlled `file.type`. `.php`, `.sh`, `.exe`, `.html`, `.svg`, `.js`, and other script/executable formats are rejected. Submission file downloads now set `X-Content-Type-Options: nosniff` so a tampered content-type can't be reinterpreted by the browser.
- **Form-submission body size cap** — form submission handlers now reject requests whose `Content-Length` exceeds 55 MB with a `413 Request too large` response, before `req.formData()` buffers the body into memory. Closes a cheap memory-DoS where a client could stream a multi-hundred-MB multipart body and rely on the per-file cap only being applied post-parse.
- **Admin media upload body size cap** — `POST /admin/api/upload-media` now applies the same `Content-Length` pre-check, gated by a new `admin.maxUploadMb` config setting (default 100 MB). Defence in depth against compromised-credential or CSRF-driven DoS; operators with large media libraries can raise the ceiling without touching code.

### Tests

- New test suites under `tests/security/` covering the sanitiser, URL allowlist, rate limiter, password strength, upload allowlist, and body-size gate. 75 new tests; 679 total passing.

---

## [0.7.3] — 2026-04-17

### Fixed

- **Raw HTML media refs in markdown** — `<img src="file.jpg">` and `<a href="doc.pdf">` tags embedded in markdown content are now rewritten to absolute route-based URLs, matching the existing behaviour for markdown `![](src)` and `[](href)` syntax.

---

## [0.7.1] — 2026-04-17

### Fixed

- **Relative links in markdown** — bare relative hrefs (`myfile.pdf`, `./doc.pdf`) are now rewritten to absolute route-based URLs before rendering. Fixes broken links caused by Dune's no-trailing-slash URL scheme resolving relative paths against the wrong parent. Non-relative URLs (`http://`, `/root`, `mailto:`, `#anchor`) and unknown filenames pass through untouched.
- **Template cache auto-invalidation** — templates in production (`dune serve`) are now reloaded automatically when their file changes, without requiring a server restart. Mtime is rechecked on each cache hit; stale entries are evicted and re-imported.

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
