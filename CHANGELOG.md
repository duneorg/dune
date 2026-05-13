# Changelog

All notable changes to Dune CMS are documented here.
This project follows [Semantic Versioning](https://semver.org). Pre-1.0 minor releases may include breaking changes per semver convention. Stable API guarantees begin at v1.0.0.

---

## [0.10.0] — 2026-05-13

### Added

- **MCP server** (`dune mcp:serve`) — JSON-RPC 2.0 over stdio, compatible with Claude Code, Cursor, and any MCP-capable agent. Exposes nine tools (`list_pages`, `get_page`, `get_page_source`, `search_content`, `get_taxonomy`, `get_config`, `get_runtime_info`, `list_templates`, `list_blueprints`) and five resources (`dune://site/config`, `dune://site/schema`, `dune://content/pages`, `dune://content/taxonomy`, `dune://content/blueprints`).
- **`dune upgrade`** — Updates the `@dune/core` specifier in `deno.json` to the latest JSR release. When running from a local source clone, prints the current version and the appropriate `git pull` command instead.
- **`dune validate`** — Whole-project lint: config structure, plugin spec pinning, template references, schema files, and content integrity (missing titles, duplicate routes, future dates). Supports `--json`.
- **`dune content:create <route>`** — Scaffold a new content page. Options: `--title`, `--template`, `--flat`, `--publish`, `--json`.
- **`dune content:delete <route>`** — Delete a content page. Requires `--confirm` or `--dry-run`.
- **`dune blueprint:list` / `blueprint:show` / `blueprint:validate`** — Inspect per-template frontmatter schemas from the CLI.
- **`dune deploy:init <target>`** — Scaffold deployment configuration for `fly`, `docker`, or `deno-deploy`.
- **`dune update:skills`** — Reinstall AI agent skill files from the current package into `.claude/skills/`.
- **`dune schema:export`** — Print the JSON Schema for `site.yaml` to stdout.
- **`GET /_dune/schema/config`** — HTTP equivalent of `schema:export`; returns the JSON Schema for `site.yaml`.
- **`GET /admin/api/introspect`** — Live runtime snapshot: page counts, plugins, theme, forms, and config summary. Requires admin auth.
- **`GET /admin/api/page-source`** — Return raw source (frontmatter + body) for a page by path. Requires `pages.read`.
- **`POST /admin/api/render-markdown`** — Server-side markdown-to-HTML conversion through the full rendering pipeline. Requires `pages.read`.
- **`POST /admin/api/dev/apply`** — Batched content and config mutations (`write`, `delete`, `frontmatter`, `config`, `plugin.install`). Dev mode only.
- **`GET /health/live` and `/health/ready`** — Split liveness and readiness probes for container and load balancer health checks.
- **`--json` flag** — Machine-readable output on `build`, `validate`, `content:list`, `content:check`, `content:create`, `content:delete`, `config:show`, `config:validate`, and all `blueprint:*` commands.
- **Agent skill files** — `dune new` now installs `.claude/skills/` files covering content, MCP, plugin authoring, schemas, auth, authz, email, and jobs conventions. `dune update:skills` reinstalls them.
- **`llms.txt` and `llms-full.txt`** — Served at `/_llms.txt` and `/_llms-full.txt`; structured documentation for agent ingestion.
- **`DuneEngine.storage`** — `StorageAdapter` is now part of the public `DuneEngine` interface, accessible to plugins and tooling.

### Fixed

- TSX content page components now receive `page.route` correctly.
- `dune upgrade` detects local source installs and redirects to `git pull` rather than attempting a `deno.json` rewrite.

### Security

- **Flex Object endpoint access control** — Role-based access control enforced on all Flex Object routes. (H1)
- **i18n endpoint permission checks** — All i18n admin routes now require the appropriate permission. (M2, L3)
- **Preview content handling hardened** — Preview fallback rendering and page access checks tightened. (M3, M5)
- **Plugin specifier allowlist tightened** — Allowed URL schemes for plugin install and apply restricted. (M4)
- **Migration importer path validation** — Path-containment checks added to all migration import handlers. (M6)
- **Rate limit IP bucketing hardened** — IP resolution for rate-limit keys tightened. (L1)
- **Dashboard endpoint permission check** — The admin dashboard endpoint now requires `pages.read`. (L2)
- **Upload body size limit** — Oversized request bodies are now rejected during streaming, before buffering. (L4)
- **Webhook delivery log sanitization** — Sensitive payload data is no longer written to delivery logs. (L5)

---

## [0.9.1] — 2026-05-07

Security release. All findings are from the May 2026 internal audit. No breaking changes to public APIs.

### Critical

- **Path traversal in submission file download** — insufficient path validation on the file download endpoint allowed escape from the submissions directory. (CRIT-1)
- **Path traversal in flex object API** — same class of issue in the flex content read endpoint. (CRIT-2)
- **Collab WebSocket document scope not enforced** — authenticated users could open a collab session for paths outside the content index. Sessions are now bound to known page paths. (CRIT-3)
- **Admin context leak in public API handlers (multisite)** — in multisite deployments, public REST handlers could resolve to the wrong site's admin context. Threaded through request state instead of a global. (CRIT-4)
- **MDX co-located imports not path-contained** — import paths in MDX content were not restricted to the page's own directory. Confined to the page directory at load time. (CRIT-5)
- **Plugin `onRequest` cookie access** — plugins could read the admin session cookie via `onRequest`. Access restricted; plugin trust model documented. (CRIT-6)

### High

- **Admin path validation hardened** — the page path validator was strengthened against bypass techniques and re-applied consistently across all path-bearing admin handlers. (HIGH-1, HIGH-2)
- **Internal error details exposed on public routes** — unhandled exceptions returned internal error strings to unauthenticated callers. Responses scrubbed to generic messages; permission errors now return 403. (HIGH-3, HIGH-7)
- **Missing CSRF checks on mutation endpoints** — several admin mutation handlers (preview, editor save, submissions, logout) lacked CSRF validation. (HIGH-4, LOW-1)
- **Security headers missing on admin routes** — admin responses now emit a full set of security headers (`Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`). (HIGH-5, HIGH-6)
- **Webhook token comparison not constant-time** — replaced with a constant-time comparison to prevent timing-based token recovery. (HIGH-8)
- **Webhook body size uncapped** — incoming webhook payloads are now size-limited before parsing. (HIGH-9)
- **iframe auto-resize `postMessage` origin not validated** — the resize listener accepted messages from any origin and replied without pinning the target origin. Both tightened to the document origin. (HIGH-10, HIGH-11)
- **Inline HTML and SVG media not sandboxed** — HTML and SVG files served from the media store now include restrictive `Content-Security-Policy` headers; SVG served with correct content type. (HIGH-12, HIGH-13)
- **MDX output not sanitized for non-admin authors** — MDX rendered output now goes through the same `trusted_html`-gated sanitizer as markdown. Also fixed a double-encoding bug in the sanitizer that corrupted image URLs containing query parameters. (HIGH-14)
- **Collab WebSocket upgrade missing auth and origin checks** — the upgrade handshake now requires a matching `Origin` header and the `pages.update` permission. (HIGH-15, HIGH-16)
- **`adminPages.permission` field not enforced at request time** — the permission declared on `AdminPageRegistration` was stored but never checked. Now validated on each request. (HIGH-17)
- **Plugin-registered route paths not validated** — `publicRoutes.path` entries are now checked against reserved prefixes at bootstrap. (HIGH-18)
- **Plugin island specifiers not path-contained** — island file paths supplied by plugins are now validated against path-containment rules. (HIGH-19)
- **SSRF on outbound webhook delivery** — webhook target URLs are now checked against a scheme and host allowlist before delivery. (HIGH-20)
- **`X-Forwarded-For` trusted by default** — forwarding headers are no longer used for rate-limiting or session IP binding unless `trusted_proxies` is explicitly configured. (HIGH-20, HIGH-21)
- **Unimplemented `auth_provider.type` silently fell back to local auth** — startup now refuses if the configured auth provider type has no implementation. (HIGH-21)
- **Search API query size unbounded** — query string length and result count are now capped. (HIGH-23)

### Medium

- **Page frontmatter serialized via string interpolation** — switched to `@std/yaml` stringify for safe YAML output on page create. (MED-1)
- **`admin.path` config not validated at startup** — malformed admin path values are now rejected at bootstrap. (MED-2)
- **CORS origin reflected unconditionally** — the public API now requires a valid, matching `site.url` before reflecting the `Origin` header. (MED-3)
- **Audit log coverage gaps** — auth denial events (CSRF failures, permission checks) are now logged. Audit log path is contained within the site root. (MED-4, MED-5)
- **Public API pagination not bounds-checked** — `limit` and `offset` parameters are now clamped to safe integer ranges. (MED-7)
- **Unpublished page existence enumerable via public API** — 404 responses for unpublished pages are now indistinguishable from absent paths. (MED-8)
- **External auth provider role claims not validated** — LDAP/SAML provisioner now validates role claims against the configured allowed role list. (MED-9)
- **PBKDF2 iterations below OWASP 2024 minimum** — bumped to 600 000 iterations; existing hashes are transparently rehashed on next successful login. (MED-10)
- **No per-account login lockout** — added a per-account lockout counter alongside the existing IP-based rate limit. (MED-11)
- **Plugin install accepted unpinned versions** — `dune plugin:install` now requires a pinned version specifier. (MED-12)
- **Theme install SSRF and integrity** — theme installation is now restricted to local registry slugs, with SSRF guards and archive hash verification. (MED-13)
- **Plugin `onRequest` could intercept admin responses** — admin-prefix paths are now excluded from plugin `onRequest` short-circuit. (MED-14)
- **Media URL rewriter gaps** — the href/src rewriter now handles single-quoted attributes and rejects unsafe URL schemes. (MED-15, MED-16)
- **Image processing without input size limits** — uploaded images are now size-checked before being passed to the processing pipeline. (MED-17)
- **Submission body size checked after parse** — the payload size cap now applies before JSON parsing. (MED-19)
- **`FormDefinition.enabled` flag** — forms can now be disabled via `enabled: false`; the public submissions API returns 404 for disabled forms. (MED-20)
- **`FileSystemAdapter` path-containment guard** — all storage operations now verify the resolved path remains within `rootDir`. (MED-21)
- **Collab WebSocket resource limits** — per-connection limits added for frame size, simultaneous connections, and message rate. (MED-22)
- **`withGuards()` helper for admin route handlers** — new utility composing auth, permission, and CSRF checks into a single call. (MED-23)
- **Open redirect on post-login `?next=`** — redirect target is now restricted to same-origin paths. (MED-24)

### Low

- **`/api/nav` and `/api/config/site` unrate-limited** — rate limits added to the remaining unguarded public read endpoints. (LOW-2)
- **`/health` information disclosure** — the health endpoint now returns a minimal response by default; detailed stats require a configurable `health_token`. (LOW-3)
- **Log injection via request paths** — paths written to error logs are now sanitized (control characters removed, length capped). (LOW-4)
- **Plugin name parameter validation tightened** — the plugin name segment in admin API routes enforces a strict allowlist and rejects path traversal via dot-segments. (LOW-5)
- **Filesystem paths in MDX error logs** — internal paths are redacted from error logs in production. (LOW-6)
- **Submission read endpoints missing permission check** — GET routes for submission data now require the `submissions.read` permission. (LOW-8)
- **User-supplied YAML parsed with extended schema** — all user-facing YAML parsing now uses the `"core"` schema, disabling implicit type coercions. (LOW-10)

---

## [0.9.0] — 2026-05-07

### Breaking

- **Admin panel rewritten as Fresh 2 file-system routes** — The monolithic `createAdminHandler` and its 16 supporting `src/admin/ui/*.ts` files have been deleted (~12 700 lines removed). The admin panel is now implemented via `src/admin/routes/` (80 route files) with proper Fresh 2 middleware, layout, and 12 Preact island components. The admin URL structure and all existing functionality are preserved; only the internal implementation changed.
  - `createAdminHandler` / `AdminServerConfig` removed from `@dune/core` public API.
  - `src/cli/site-handler.ts` deleted. Framework integrators previously using `createProductionSiteHandler` or `createDevSiteContext` directly should migrate to `createDuneApp()` from `src/cli/fresh-app.ts`.
- **`PLUGIN_API_VERSION` bumped to `"0.7"`** — Plugins that check for `"0.6"` with strict equality should update their guard.

### Added

- **`DunePlugin.publicRoutes`** — Plugins can register public-facing Fresh routes via `publicRoutes` instead of the `onRequest` hook. Each route is a proper Fresh handler with `ctx.render()`, middleware, and island support. Preferred for stable named endpoints.
- **`DunePlugin.adminPages`** — Plugins can contribute pages to the admin panel. Each page is rendered inside the admin shell (sidebar, header, auth) automatically.
- **Theme island auto-discovery** — `collectThemeIslands()` walks the full theme inheritance chain and registers all `islands/*.tsx` files automatically. Child themes can use parent islands without manual configuration.
- **TSX content page island support** — `collectContentIslands()` scans TSX content pages for relative imports that resolve into any `islands/` directory and adds them to the bundle automatically.
- **Headless mode** — `dune new --headless` scaffolds a headless Dune site. `mountDuneAdmin(app, ctx)` and `getDuneAdminIslands()` in `@dune/core/admin` let Fresh developers add Dune's admin panel to their own app without surrendering the `/*` catch-all. `getContent()` / `ContentApi` in `@dune/core/content` provide typed access to the content engine.
- **Auth provider wired from config** — `admin.auth_provider` in `system.yaml` (`ldap` / `saml`) is now actually honoured at bootstrap. Previously `LocalAuthProvider` was always used regardless of config.
- **`BootstrapOptions.authProvider`** — Pass a custom auth provider at startup to override both config and the local default (useful for OIDC, SSO).

---

## [0.8.4] — 2026-05-04

### Fixed

- **Co-located audio and video not rewritten** — `<source src="./file.mp3">`, `<audio src="./file.mp3">`, and `<video src="./file.mp4">` relative references were not rewritten to absolute URLs, causing 404s in the browser. A new media resolver pass handles these elements identically to the existing `<img>`, `<a>`, and `<iframe>` passes.

---

## [0.8.3] — 2026-05-04

### Fixed

- **Co-located iframe src not rewritten** — `.html` was missing from `MEDIA_EXTENSIONS`, so HTML files were never indexed by `discoverMedia()`. `ctx.media.get('file.html')` always returned null, silently skipping the iframe src rewrite introduced in 0.8.2.

- **Iframe regex failed on multiline tags** — The previous `[^>](?!src=)` pattern did not match `<iframe>` opening tags where attributes span multiple lines (e.g. `width`, `height`, and `src` on separate lines). Replaced with `[\s\S]*?` (lazy dotall) which handles both inline and multiline tags correctly.

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
