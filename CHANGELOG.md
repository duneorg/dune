# Changelog

All notable changes to Dune CMS are documented here.
This project follows [Semantic Versioning](https://semver.org). Pre-1.0 minor releases may include breaking changes per semver convention. Stable API guarantees begin at v1.0.0.

---

## [0.24.1] — 2026-07-01

### Security

- **High: Path traversal via plugin `islandSpecifiers` (build-time).** Plugin-supplied
  `islandSpecifiers` were spread into the client JS bundler without the path-validation
  guard already applied to `publicRoutes[].island`. Added `isValidPluginIslandSpecifier()`
  validation in both `serve.ts` and `dev.ts`; invalid specifiers are rejected with a
  warning log. Affects `@dune/core` ≥ 0.24.0.

- **High: Stored XSS via unvalidated grid column value in page-builder renderer.**
  The `columns` frontmatter field accepted by `renderFeatures`, `renderGallery`, and
  `renderColumns` was interpolated directly into an HTML class attribute without
  sanitization. Introduced `safeGridCols()` which allowlists values before interpolation.

---

## [0.24.0] — 2026-06-30

### Added

- **`@dune/plugin-admin` — the Dune admin panel is now a standalone JSR package.**
  The admin panel, block editor, user management, auth middleware, audit logging,
  machine translation, staging engine, workflow, collab, submissions, and all admin
  Fresh routes have been extracted from `@dune/core` into
  [`jsr:@dune/plugin-admin`](https://jsr.io/@dune/plugin-admin). Core is now a pure
  content engine with no admin-specific code. Existing sites continue to work without
  changes — the plugin is auto-registered by `bootstrap()`.

- **`DunePlugin.mount(api: MountApi)` lifecycle hook.** Plugins that need to register
  Fresh routes, middleware, or layouts can now do so in `mount()`, which is called
  after `bootstrap()` once the Fresh `App` instance is available. `setup()` continues
  to run at bootstrap time (before the app exists). `MountApi` provides `{ app,
  bootstrap, adminServices }`.

- **`mountPlugins(app, ctx)` in `@dune/core/plugins`.** Replaces the direct
  `mountDuneAdmin(app, ctx)` call in headless setups. Calls `collectAdminServices()`
  then iterates all plugins invoking their `mount()` hooks in registration order.
  Headless developers: replace `mountDuneAdmin` with `mountPlugins`.

- **25 new subpath exports from `@dune/core`** — exposes internal modules that
  first-party plugins (and custom admin implementations) depend on:
  `./hooks`, `./config`, `./storage`, `./staging`, `./workflow`, `./session`,
  `./audit`, `./mt`, `./security`, `./history`, `./metrics`, `./flex`, `./images`,
  `./forms`, `./jobs`, `./blueprints`, `./search`, `./nav`, `./types`,
  `./auth/passwords`, `./auth/provisioner`, `./auth/authz-adapter-local`,
  `./auth/authz-adapter-db`, `./bootstrap`, `./content/types`.

- **`ContentEditorPlugin` decoupled from `AdminState`.** The interface moved from
  `src/admin/types.ts` to `src/hooks/types.ts` and now uses `FreshContext<any>`
  instead of `FreshContext<AdminState>`, so it is expressible in core without
  importing admin-internal types. The change is backwards-compatible: the type
  becomes more permissive, not less.

### Changed

- **`BootstrapResult` is significantly slimmer.** Twelve fields that were
  admin-specific (`users`, `sessions`, `auth`, `authProvider`, `workflow`,
  `scheduler`, `submissionManager`, `stagingEngine`, `collabManager`, `auditLogger`,
  `mt`, `pluginAdminPages`) have been removed. `adminContext` remains but is `null`
  until `mountPlugins()` runs; it is then set by `@dune/plugin-admin`'s `mount()`
  hook. `history` and `flexEngine` stay in `BootstrapResult` — both are core-level
  concerns used outside the admin panel.

- **`./admin` subpath export removed from `@dune/core`.** Imports from
  `jsr:@dune/core/admin` (previously `mount.ts`) are now available from
  `jsr:@dune/plugin-admin/admin/mount`. This is a breaking change for any code that
  imported `mountDuneAdmin` or `registerAdminRoutes` from `@dune/core/admin` —
  update those imports to `@dune/plugin-admin/admin/mount`.

### Migration

No changes to `site.yaml` are required for existing sites. `bootstrap()` continues to
auto-register the admin plugin when `admin.enabled` is not `false`. Sites that want to
opt out of the admin panel entirely can now do so cleanly by setting
`admin: { enabled: false }` in `system.yaml` — no admin routes, user pool, or
auth overhead will be initialised.

Headless developers who called `mountDuneAdmin(app, ctx)` directly should replace it
with `mountPlugins(app, ctx)` from `@dune/core/plugins`.

---

## [0.23.0] — 2026-06-29

### Added

- **Pluggable search backends.** Two new plugin hooks make the search engine extensible:
  - `onSearchRecordsCollect` — plugins push extra records (each with its own result `route`, indexed from memory) to include in the search index.
  - `onSearchEngineCreate` — plugins provide an alternative `SearchEngine` (e.g. a Meilisearch backend) in place of the built-in in-memory engine. The hook payload includes a `loadText(page)` helper so an alternative engine can index the same plain-text bodies the built-in engine does.

- **`createSearchEngine` accepts `injectedRecords`** — plugin-contributed records are indexed alongside content pages and retained across rebuilds. Exposed via `onSearchRecordsCollect`.

- **Exported `loadPageBodyText` and `stripSearchMarkup`** from `@dune/core` search — reusable helpers for loading and plain-text-stripping a page's body, used by the built-in engine and available to alternative engines.

These hooks back the v0.23 plugin-API integration of `@dune/plugin-pdf` (PDF serving + text search) and `@dune/plugin-meilisearch` (Meilisearch backend), both of which now enable from `site.yaml` with no manual wiring.

- **`dune plugin:install` prints setup guidance for first-party plugins.** Installing `@dune/plugin-pdf` creates `static/pdfs/` and prints the `site.yaml` config block; installing `@dune/plugin-meilisearch` prints the required environment variables and config keys.

- **`generate:plugin` scaffold updated** — the generated plugin now uses the `hooks: {}` object form (the previous scaffold omitted the required `hooks` field) and includes commented `onSearchRecordsCollect` / `onSearchEngineCreate` examples.

### Fixed

- **Marketplace plugin registry now lists only real, published plugins** (`@dune/plugin-inline-edit`, `@dune/plugin-pdf`, `@dune/plugin-meilisearch`). The previous registry advertised fabricated entries (nonexistent `dune-cms` GitHub org, fake download counts, unpublished JSR packages) that would 404 on install, and omitted the real plugins.

- **`plugin:create` scaffold import corrected** from the nonexistent `jsr:@dune-cms/core/hooks` to `jsr:@dune/core/plugins`, so generated plugins resolve `DunePlugin`.

## [0.22.0] — 2026-06-29

### Added

- **`dune serve --frozen`** exits with a clear message pointing to `dune lockfile sync` when the lockfile is incomplete for the current `deno.json`. Previously, running without `--frozen` would silently drift; now the Dune-level flag makes lockfile staleness a hard, actionable error in production deployments.

- **Startup staleness hint in `dune dev` and `dune serve`.** At startup, Dune checks whether the lockfile contains an entry for the current `@dune/core` version. If not, it prints a clear warning before continuing — catching manual `deno.json` edits or upgrades made outside `dune upgrade` before they cause a surprise deployment failure. The check is fast (no subprocess) and non-blocking in dev mode.

- **`dune upgrade` auto-runs `lockfile sync`** after bumping the `@dune/core` version, so the lockfile stays consistent without a separate manual step.

- **`dune add` auto-runs `lockfile sync`** after adding a new import to `deno.json`, for the same reason.

### Fixed

- **Plugin marketplace registry entry corrected for `@dune/plugin-meilisearch`.** The entry had the wrong package name and JSR specifier from an earlier draft.

---

## [0.21.7] — 2026-06-16

### Fixed

- **`lockfile:sync` recorded an incomplete dependency block for `@dune/core`, so a `--frozen serve` could still fail right after a successful sync.** The discovery pass only traced the narrow slice of dune-core that plugin loading touches (`storage`/`config`/`hooks`/`plugin-loader`) — about three dependencies — whereas actually running `serve` exercises far more of dune-core's own graph (the DB drivers, mailer, image processing, multisite manager, etc., reached via dynamic imports `cli-impl.ts` pulls in for every command). Deno records a package's dependency block from whatever graph was traced during resolution, so the synced lockfile's `@dune/core` entry was well-formed but missing ~15 dependencies, and the next `--frozen serve` rejected it as out of date. `sync` now also caches the site's pinned `@dune/core@X/cli` entrypoint — the same module `serve` itself loads — so the recorded closure matches what `serve` will actually need, independent of which plugins are configured. (Deno follows literal-string dynamic imports statically, so this captures the config-gated runtime branches too; only variable-argument imports of site-local files are excluded, and those are the site's own surface, handled separately by plugin discovery.)

- **Just invoking `dune lockfile:check`/`lockfile:sync` could itself dirty `deno.lock` before either command's own code ran, regardless of git state.** The CLI auto re-execs itself with `--config=<site deno.json>` whenever the site root has its own config, so dynamically-imported theme TSX files can resolve the site's import map — but it did this unconditionally, including for the lockfile commands, which don't render anything and already manage their own properly-scoped (scratch-lockfile) subprocess internally. That re-exec resolved the CLI's own module graph against the site's real `deno.lock`, unfrozen, before `lockfile:check`/`lockfile:sync` ever got a chance to read "original" — the exact incidental-drift problem these commands exist to prevent, and the actual root cause of inconsistent results seen across repeated runs. `lockfile:check`/`lockfile:sync` are now excluded from the auto re-exec, and the "original" baseline is read directly from disk — the previous preference for a git-committed copy (added in 0.21.2 to work around this same symptom) is removed; it was treating a downstream effect as if it were the cause.

---

## [0.21.5] — 2026-06-16

### Fixed

- **A content page-folder whose slug matched a reserved path prefix (`static`, `themes`, or `plugins`) was unreachable at its own canonical URL.** Found live in production: a page at `content/plugins/` correctly 301-redirected `/plugins` → `/plugins/` (the content router knew the page existed), but requesting `/plugins/` itself 404'd, because the wildcard static-asset and plugin-asset routes (registered before the content catch-all) intercepted it first and never found a matching file. This became reachable specifically once page-folders started serving at a trailing slash (0.20.0) — before that, the non-slash canonical form didn't collide with the wildcard pattern. The `/static/*`, `/themes/*`, and `/plugins/*` handlers now fall through to content resolution when no static or plugin asset matches, instead of 404ing immediately.

---

## [0.21.4] — 2026-06-16

### Fixed

- **`lockfile:check` could silently destroy an uncommitted `lockfile:sync` result.** 0.21.2 made `check` restore the on-disk lockfile to its git-committed state afterward, to avoid leaving a surprise dirty working tree from the outer process's own module-graph resolution. That's indistinguishable from "an uncommitted `sync` run sitting on disk" — running `check` between `sync` and committing silently reverted the sync. `check` no longer touches the lockfile at all, regardless of how it differs from git HEAD; there is no way to tell incidental taint apart from legitimate uncommitted work from where this command runs, so it doesn't try.

---

## [0.21.3] — 2026-06-16

### Added

- **`lockfile:check`/`lockfile:sync` surface the underlying `--frozen` error when the merge isn't self-consistent.** Previously, when no blocked entries explained the inconsistency, the report just said "this likely indicates a gap in the merge algorithm" with nothing to act on. The raw validation error is now included (in both human-readable and `--json` output) so a real cause can actually be diagnosed instead of guessed at.

---

## [0.21.2] — 2026-06-16

### Fixed

- **`lockfile:check`/`lockfile:sync` could diff against an already-tainted lockfile** — merely invoking `dune` via `deno run jsr:@dune/core@X/cli ...` resolves the running CLI's own module graph into whichever lockfile is ambient for the project, unconditionally, before any of the command's own code runs. That side effect could silently bump already-pinned shared entries — exactly the incidental-drift problem these commands exist to prevent — before the merge ever read "original" from disk. Both commands now read the lockfile as last committed to git (falling back to disk only when there's no git history to compare against), so the merge is protected regardless of what the outer process load did to the working copy. `lockfile:check` additionally restores the on-disk file to its committed state afterward, since a read-only diagnostic shouldn't leave a surprise dirty working tree behind.

---

## [0.21.1] — 2026-06-16

### Fixed

- **`dune lockfile check` crashed instead of reporting a conflict** — found immediately while rolling 0.21.0 out to a real site: when the merge would leave the lockfile internally inconsistent (the disambiguation edge case from 0.21.0's own release notes), `check` — a read-only diagnostic that never writes anything — threw a raw internal error with a multi-thousand-line diff dump instead of reporting it cleanly. The consistency check now only gates `sync` (which actually writes); `check` reports `consistent: false` like any other finding. `sync` also now explains *why* a blocked entry exists and points at the exact `--upgrade <specifier>` to resolve it, rather than implying it's always a bug to report.

---

## [0.21.0] — 2026-06-16

### Added

- **`dune lockfile check` / `dune lockfile sync`** — a site's `deno.lock` only gains entries for a plugin's dependencies (and, via the bundling subprocess, its browser-side npm packages) the first time `serve` actually starts after that plugin or a version bump is installed. Until then, the running process resolves them itself against an unfrozen lockfile, which is what silently dirties `deno.lock` on disk after a deploy.
  - `dune lockfile sync` runs that same resolution ahead of time and writes the result, but **only ever adds genuinely missing entries** — an already-pinned entry that would resolve to a different value (e.g. the registry now serves a newer match for an already-locked semver range) is left exactly as committed. Pass `--upgrade <specifier>` (repeatable, or comma-separated) to intentionally allow a specific pin to change; the exact key to pass is printed in the "left unchanged" list.
  - `dune lockfile check` runs the same comparison read-only and exits non-zero if anything is missing, without writing. Suitable as a pre-restart gate (e.g. an `ExecStartPre=` step in a systemd unit) so a deploy never gets partway through restarting before discovering the lockfile is stale.
  - Both commands support `--json` for machine-readable output.

---

## [0.20.1] — 2026-06-16

### Fixed

- **Infinite redirect loop on multilingual trailing-slash page-folder URLs** — requesting `/fr/ecosystem/` (or any `/{lang}/{page-folder}/` URL) caused a redirect loop. The language-prefix stripping used `split("/").filter(Boolean).join("/")` which dropped the trailing slash, producing route `/ecosystem` instead of `/ecosystem/`. The canonical-redirect step then found `/ecosystem/` at the "other form" and issued a 301 back to `/fr/ecosystem/` — the same URL. Fixed by slicing the language prefix off the normalised string directly (`normalized.slice(1 + lang.length)`), which preserves the trailing slash.

---

## [0.20.0] — 2026-06-15

### Added

- **Trailing-slash canonical URLs for page-folder pages** — pages backed by a folder on disk (`04.blog/01.my-post/default.md`) now serve at `/blog/my-post/` (with trailing slash) instead of `/blog/my-post`. Flat content files (`articles/my-article.md`) are unaffected and continue to serve without a trailing slash. The `<link rel="canonical">`, sitemap `<loc>`, and feed `<link>` entries all emit the correct form automatically, since they derive from `PageIndex.route`.

- **Canonical-form redirects (both directions)** — if a visitor arrives at the wrong slash form, Dune issues a 301 to the correct canonical URL. The redirect is symmetric and evidence-based: it only fires when a resource is found at the other form. If both forms exist independently (a flat `about.md` and a page-folder `about/default.md`), each URL serves its own resource with no redirect.

- **Relative cross-page links via URL arithmetic** — `RenderContext` gains `pageRoute?: string` (populated from `PageIndex.route` in the page loader). In `media-resolve.ts`, after a media lookup misses, relative `href` values in both markdown links and `<a>` tags are resolved using `new URL(href, base)` URL arithmetic. The resulting root-relative path then flows through `rewriteInternalLinks()`, so multilingual relative links (`./related/`) automatically gain the correct language prefix — fixing a long-standing silent breakage.

### Breaking Changes

- **Page-folder routes now include a trailing slash.** Any hardcoded root-relative link (`[see](/blog/my-post)`) or `href="/contact"` pointing at a page-folder will 301 to the trailing-slash form — no manual change required for visitors. For a clean audit: search `content/` for `](/` patterns and update links to add `/`; update any `href="..."` in theme templates; update `site.yaml` `redirects:` target URLs; update `homeRoute` derivations in themes to append `/`; update `isActiveRoute` prefix checks to handle routes that already end with `/`.

---

## [0.19.2] — 2026-06-13

### Fixed

- **Admin bar missing on language-prefixed routes (`/de/`, `/fr/`, etc.)** — the plugin response-transform pipeline matched pages using `url.pathname` directly, but language-variant routes carry a two-letter prefix (`/de/page`) while the page index stores bare routes (`/page`). The pipeline now strips the language prefix before matching and also prefers the correct language variant from the index, fixing both the missing admin bar on localised pages and the wrong-language markdown being loaded into the inline editor when editing an English page that shares a route with a German variant. The RTL-direction injector in `fresh-app.ts` had the same bug and is fixed in the same way.

---

## [0.19.1] — 2026-06-13

### Fixed

- **Routing regression: Grav-style page folders now work in plain (non-numeric) directories** — since 0.15.0, a content file with a non-reserved stem inside a plain folder (e.g. `blog/my-post/post.md`) was always treated as a flat content file, routing to `/blog/my-post/post` instead of `/blog/my-post`. Dune now checks the file's stem against the theme's actual template names: if the stem matches a template (e.g. `post.md` when `templates/post.tsx` exists), the folder is treated as a page folder and the folder path becomes the route. Files whose stems don't match any template continue to route as flat files. This restores the behaviour present before 0.15.0 without regressing any existing flat-file archives.

---

## [0.19.0] — 2026-06-12

### Added

- **Plugin client entries** — plugins can declare browser entry points via `DunePlugin.clientEntries` (name → module specifier). Each entry is bundled at startup with `deno bundle --platform browser` — resolving the plugin's own npm/jsr dependency graph, so e.g. an editor plugin's TipTap stack never appears outside that plugin — and served at `/plugins/{name}/{entry}.js` with content-hash ETags and 304 handling. Bundles are cached in `.dune/client-bundles/` keyed by plugin name+version (superseded versions are pruned at startup); production bundling runs with `--frozen`, so what ships to browsers depends on the committed lock file, not registry state at boot. Bundle failures log and skip without blocking app start.
- **Inline-edit marker components** — `@dune/core/ui/editable` returns as `EditableText`, `EditableMarkdown`, `EditableField`, `EditableDate`, `EditableImage`: **server-only** components that render the `data-dune-*` marker attributes and nothing else (no JavaScript, no editor implied — not the pre-0.17 island kit). Markers are the contract between themes and editor plugins: raw attributes and components are interchangeable, and templates never import from an editor plugin. The starter template marks its body wrapper with `data-dune-body`.

### Security

- **`data-dune-*` markers are scrubbed from responses without an editing session** — markers are baked into templates, but the response pipeline now strips them from HTML served to anyone without a validated session holding `pages.update`. Anonymous visitors and crawlers never see content source paths (`data-dune-source`) or an editable-regions fingerprint; the scrub decision rests on the validated session, not cookie presence. Themes must not use `data-dune-*` attributes as CSS/JS hooks for public styling.

---

## [0.18.2] — 2026-06-12

### Fixed

- **0.18.1 crashed on boot when served from JSR** — the manifest-based island registration passed `https://` specifiers to Fresh's Builder, whose build cache only accepts local file paths (`Path must be absolute`). Remote island specifiers (admin islands on JSR installs, and `jsr:`/`npm:` plugin islands) are now materialized as local wrapper modules under `.dune/remote-islands/` before registration. Local checkouts were unaffected. If you upgraded to 0.18.1, skip directly to 0.18.2.

---

## [0.18.1] — 2026-06-12

### Fixed

- **Admin panel restored on JSR-served sites** — `/admin` had been silently 404ing on every site running Dune from JSR since 0.10.0. Fresh's `fsRoutes()` discovers route files by crawling a local directory; when running from JSR there is no local directory, so no admin routes were ever registered and `/admin` requests fell through to the content router. Admin routes and islands are now registered from a generated static manifest (`src/admin/manifest.gen.ts`, regenerated via `deno task gen:admin-manifest`), which works identically from JSR and a local checkout. Local dev was never affected.
- Removed a stale import of the extracted inline-edit module from the admin content API (latent since 0.17.0 — admin route files were previously outside the static import graph, so it went undetected).

### Changed

- `src/cli.ts` now carries a `@module` doc tag, completing module docs on all entrypoints.
- Publishing workflow re-enables provenance attestation (the upstream JSR publish bug, jsr-io/jsr#1448, is fixed).

---

## [0.18.0] — 2026-06-10

### Breaking Changes

- **`@dune/core/ui/editable` removed** — the entire inline-editing component kit (`EditableText`, `EditableMarkdown`, `EditableImage`, `EditableDate`, `EditableField`, `AdminBar`, the field editor registry, and the edit-mode context helpers) now lives in `@dune/plugin-inline-edit/ui/editable`. Update theme imports accordingly. This keeps the TipTap/Y.js dependency tree — and the plugin's WebSocket endpoint knowledge — entirely out of core.
- **`@dune/core/inline-edit` reduced to the service port** — it now exports only what core's admin endpoints consume: `InlineEditManager`, `ActiveEditor`, `DocumentPresence`. The implementation types (`InlineEditClient`, `InlineEditSession`, `InlineEditManagerOptions`) moved to `@dune/plugin-inline-edit`.

### Added

- **`DunePlugin` and the other hook types are now exported from `@dune/core/plugins`** — plugin authors can type their plugin against the plugin API subpath alone, without importing the main `@dune/core` barrel.

---

## [0.17.0] — 2026-06-10

### Breaking Changes

- **Inline editing requires `@dune/plugin-inline-edit`** — the built-in Y.js/WebSocket inline editor has been moved to the separate `jsr:@dune/plugin-inline-edit` package. Sites using inline editing must add it to their `plugins:` list in `site.yaml`. Core no longer depends on yjs, y-protocols, or lib0.

### Added

- **`DunePlugin.transformResponse`** — new plugin hook for transforming HTTP responses before they are sent to the client. Core pre-resolves the authenticated user and the matched content page; plugins do not need to re-authenticate. Plugins are called in registration order and compose cleanly. See `ResponseTransformContext` in `@dune/core/plugins`.
- **`DunePlugin.adminServices`** — factory hook called during bootstrap for plugins that contribute admin-context services (e.g. a custom inline editing manager). See `AdminServicesContext` and `AdminServices` in `@dune/core/plugins`.
- **Transform pipeline ETag fingerprinting** — each transform plugin's `name@version` is folded into page ETags, so adding, removing, or upgrading a transform plugin invalidates page-cache entries and browser-cached copies automatically.
- **`isAdminPath()` helper** in `serve-utils.ts` — boundary-aware admin path check used by all guards so sibling content routes (e.g. `/administrivia` when prefix is `/admin`) are not incorrectly treated as admin paths.

### Fixed

- Plugin `transformResponse` auth context now correctly enforces the `pages.update` permission gate. Previously any authenticated admin session populated `ctx.auth` as non-null regardless of permissions; read-only accounts could receive edit chrome from plugins that trusted the documented contract.
- Plugin `onRequest` responses and `Set-Cookie` headers are no longer dropped for content routes whose path starts with but is not under the admin prefix (e.g. `/administrivia` with a `/admin` prefix).

### Security

- **`transformResponse` auth contract** — `ctx.auth` is now null for sessions that lack `pages.update`, matching the documented contract and preventing plugins from exposing edit chrome or content API URLs to read-only roles.
- **Transform pipeline caching contract** — documented that transform output must depend only on `ctx.auth` and `ctx.page`; removed A/B testing as a suggested use case (output cached under pathname key, served to all visitors).

### Changed

- `--unstable-kv` is now declared in `deno.json` under `"unstable"` rather than on the test task CLI flag, so it applies to `deno check`, the LSP, and bare `deno test` invocations.
- `admin-bar-inject.ts` is now a single-function module (`hasAdminSessionCookie`); all admin bar HTML and injection logic lives in `@dune/plugin-inline-edit`.

---

## [0.16.3] — 2026-06-09

### Security

**Critical**

- **Database column allowlisting** — column identifiers used in repository update and upsert operations are now validated against the model's field schema before being incorporated into SQL.

**High**

- **Admin-bar cache isolation** — responses rendered for requests carrying an admin session cookie are no longer stored in or served from the shared page cache. Such responses are marked `Cache-Control: private, no-store` and carry no `ETag`. The admin bar injection now routes through the full authentication middleware and requires the `pages.update` permission; revoked or read-only accounts no longer receive edit chrome.
- **External-JWT claim validation** — when external-JWT mode is configured, the token's `iss`, `aud`, and `nbf` claims are now validated against the configured values. A startup warning is emitted when neither `issuer` nor `audience` is set.

**Medium**

- **Database ORDER BY and WHERE column allowlisting** — column identifiers in dynamically-constructed `ORDER BY` and `WHERE` clauses are now validated against the schema's field list before use in SQL.
- **SSRF-hardened outbound fetch** — webhook dispatch, CDN provider calls, and theme installation now use a fetch wrapper that pins the resolved IP address and disables transparent redirects, closing a DNS-rebinding window between resolution and connection.
- **Migration DDL identifier quoting** — SQL identifiers and literal values in generated migration statements are now properly quoted rather than interpolated verbatim.
- **JWT algorithm pinning** — an optional `algorithm` field on the external-JWT config (`"HS256"` or `"RS256"`) allows operators to pin the accepted signing algorithm; tokens carrying a different `alg` header are rejected before any key material is consulted.
- **Plugin source scheme restriction** — plugin specifiers using a cleartext `http:` scheme are now rejected at both load time and island-specifier validation. `https:`, `jsr:`, `npm:`, and local paths remain supported.

**Low**

- **Media-picker postMessage origin check** — the inline-edit media-picker message handler now validates `event.origin` against the current window's origin before processing the message.
- **CSRF check header fallbacks** — when the `Origin` request header is absent, the CSRF check now consults `Sec-Fetch-Site` and `Referer` as additional signals rather than passing the request unconditionally.
- **Strict HMAC mode for authorization tuples** — setting `DUNE_AUTHZ_HMAC_STRICT=1` (or the `strictHmac` constructor option) causes unsigned authorization tuple files to be rejected rather than loaded when an HMAC key is configured. The default remains permissive to preserve the documented `dune authz:sign` migration path.

---

## [0.16.2] — 2026-06-09

### Fixed

- **JSR re-exec** — when `dune dev`/`serve` is run from the global JSR install in a site directory, the re-exec with the site's `deno.json` now correctly targets `cli.ts` (which calls `main()` at module level) instead of `cli-impl.ts` (which only exports it). Previously the re-exec'd process exited immediately without starting the server.

---

## [0.16.1] — 2026-06-09

### Added

- **Collection `excerpt` field** — `PageIndex` now has an `excerpt?: string` field, pre-computed synchronously at collection load time. Templates can read `item.excerpt` directly without `await`; `summary()` remains available for non-collection contexts. `summary()` also now truncates at word boundaries with an ellipsis rather than mid-word.
- **`htmlToMarkdown` converter** — lightweight HTML→Markdown utility used by the admin bar to round-trip rendered content back to Markdown for the body editor.

### Fixed

- **Admin overlay UX** — click directly on the annotated `<h1>` or body element to edit inline; no separate button needed. Dropped `<main>` from body annotation selector; tightened class regex to avoid false matches on hyphenated names like `content-header`; stale Escape keydown listener now removed correctly on cancel; body-location fetch deferred until first interaction.
- **CLI shim** — `cli.ts` split into a zero-dependency shim and `cli-impl.ts`. The shim re-execs with the live `deno.json` when running from local source, preventing stale import-map snapshots after adding dependencies.
- **Fresh update nag suppressed** — `FRESH_NO_UPDATE_CHECK=true` set at CLI startup so site users never see Fresh's version-available banner (Fresh is an internal Dune dep, not a site dependency).

---

## [0.16.0] — 2026-06-08

### Added

- **Inline editing** — collaborative in-place editing for admin users visiting public pages. When a valid admin session cookie is present, the admin bar is injected before `</body>` with Save, Edit/Preview toggle, and Open-in-admin controls. No template changes required — the auto-overlay pass annotates the first `<h1>` and the `<article>`/`<main>` container automatically.
- **Component kit** (`@dune/core/ui/editable`) — Preact island components for explicit inline editing in TSX templates: `EditableText`, `EditableMarkdown` (TipTap WYSIWYG, Y.js backed), `EditableImage`, `EditableDate`, `EditableField` (generic with registry lookup).
- **Field editor registry** — `registerFieldEditor(type, component)` for custom blueprint field types; lookup priority: render prop > registry > built-in fallback.
- **Y.js collaboration backend** — WebSocket sync endpoint at `GET /admin/collab/edit-ws?path=`; in-memory Y.js document manager with `commit-to-history` flush via `POST /admin/api/content/:path/commit`; frontmatter field patching via `PATCH /admin/api/content/:path/fields`.
- **Presence indicators** — admin pages list shows live colour-dot badges (`{N} editing`) next to any page that has active inline-edit sessions; polled every 30 s via `GET /admin/api/inline-edit/presence`.

### Fixed

- Stale `createAdminHandler` / `AdminServerConfig` exports removed from `@dune/core` barrel (`src/admin/mod.ts`); the monolithic handler was deleted in an earlier refactor but the re-exports remained.

### Security

- Hardened HTML escaping in admin-bar inline script blocks.
- Strengthened path validation for the WebSocket sync endpoint.
- Fixed a document-key encoding edge case in the Y.js collab layer.

---

## [0.15.4] — 2026-06-08

### Fixed

- Startup hang (100% CPU) on sites using flat-file content layouts (e.g. `blog/post-slug/post.md`). The sitemap generator's ancestor traversal would find a page as its own parent and spin indefinitely. A cycle guard now breaks out when the same page is visited twice.

---

## [0.15.3] — 2026-06-08

### Fixed

- Server startup crash when running from JSR — `Deno.chdir()` in `serve`, `dev`, and multisite manager was deriving a local path from `import.meta.url`, which is an HTTPS URL (not `file://`) under JSR. The path computed to `/@dune/core/0.15.x/` which doesn't exist. Guard added: chdir only runs when `import.meta.url` starts with `file://`; JSR deployments rely on the site's own `deno.json` for preact import resolution.

---

## [0.15.2] — 2026-06-08

### Fixed

- JSR score: added JSDoc to 115+ previously undocumented exported symbols across 54 files, bringing documented-symbol coverage to near 100%.

---

## [0.15.1] — 2026-06-08

### Fixed

- JSR score: add explicit return types (`JSX.Element` / `JSX.Element | null`) to all exported UI components so the package passes fast-check without `--allow-slow-types`.
- JSR score: add explicit `AuthSchema` type annotation to `duneAuthzSchema` export.
- JSR score: add `@module` JSDoc tag to `src/auth/authz.ts` and `src/core/logger.ts` entry points.

---

## [0.15.0] — 2026-06-08

### Added

- **Flat content files** — `.md` and `.tsx` files placed directly in a plain (non-numeric) folder route by filename stem: `articles/my-post.md → /articles/my-post`. Reserved stems (`default`, `index`) continue to represent the folder's own page. `@self.children` and `@self.descendants` in collections now include flat files.
- **TSX `handler` export** — TSX content pages can export a `handler: Handlers<Data>` object alongside the default component, mirroring Fresh's route handler idiom. `GET`, `POST`, and other methods dispatch through it before rendering. `ctx.render(data)` passes data to the component as `PageProps<Data>.data`. The content catch-all now accepts all HTTP methods so POST requests reach the handler.
- **`@frontmatter` collection source** — Resolves collection items from a frontmatter array field on the current page. Each entry is a slug string or an object with a `slug` property; order follows the frontmatter declaration. Useful for curated lists where editors control exact selection and order.
- **Themed 404 pages** — When the active theme exposes a `layout` component, 404 responses are rendered through it so the site header, nav, and footer are present. Falls back to the existing bare-HTML 404 when no layout is found.
- **Island discoverability** — `dune new` scaffold now creates `themes/starter/islands/NavToggle.tsx` (a working hamburger toggle) and adds the required esbuild import map entries to `deno.json`. The new `skills/dune-themes.md` agent skill documents the full islands pattern and is installable via `dune update:skills`.

### Fixed

- Orphan protection (`&nbsp;`) was replacing the last space inside HTML attribute values (e.g. `class="cta-button cta-secondary"` → broken CSS selector). Fixed by walking the string at tag-depth 0 — only spaces in text nodes are considered.

### Breaking

- **`SearchEngine.search()` and `suggest()` are now async** (return `Promise`). The built-in in-memory engine wraps synchronous results in `Promise.resolve()` — no behavior change. Custom search engine implementations must update their signatures.

---

## [0.14.0] — 2026-06-02

### Added

- **`termPageFor` frontmatter** — Any published page can declare itself the editorial home for a taxonomy term. Shorthand (`termPageFor: deno` → implies the `tag` vocabulary) or explicit map (`termPageFor: { category: tutorials }`). Stored as `PageIndex.termPageFor` (normalised at index time).
- **`termPage(vocab, value)` content API** — Look up the editorial page for a taxonomy term. Returns a `ResolvedPage` or `null`. Available as `page.termPage()` in templates and via `content.termPage()` in plugins.
- **`TaxonomyTerm.pageRoute`** — Populated from the `termPageFor` index; `null` when no editorial page exists for the term.
- **`PageIndex.extra`** — Custom facet field values are now extracted at index time into `PageIndex.extra`, enabling `facet[field]=value` filters on arbitrary frontmatter fields without loading full page frontmatter.

### Fixed

- Browser cache not invalidated on content-only updates — `mtime` is now included in the ETag hash, so any file modification produces a new ETag after a server restart.
- Custom facet fields (non-taxonomy, non-template) were not resolved in facet filter and count queries — `p.extra` is now applied correctly in both the filter and aggregation paths.
- `termPage()` lookup key collision when taxonomy vocabulary names contain `:` — replaced flat `"vocab:value"` composite key with a nested `Map<vocab, Map<value, route>>`.
- Custom facet field values in `p.extra` could shadow standard `PageIndex` fields (`template`, `published`, `language`, etc.) in facet queries — explicit fields now always take precedence.

---

## [0.13.0] — 2026-05-16

### Added

- **Background jobs** — Cron-scheduled server-side tasks defined as TypeScript files in `jobs/`. Export a `JobDefinition` with `name`, `schedule` (standard 5-field cron), and `handler`. Handlers receive a `JobContext` with access to `content`, `config`, `storage`, `logger`, and `email`. State persisted to `runtimeDir/jobs/`. Uses `Deno.cron()` on Deno Deploy; minute-tick interval elsewhere. Manual trigger via `POST /admin/api/jobs/{name}/run`.
- **MCP write tools** — Nine new tools added to the MCP server: `write_page`, `delete_page`, `update_frontmatter`, `update_config`, `install_plugin`, `scaffold_plugin`, `scaffold_route`, `scaffold_form`, `scaffold_theme`. Write tools modify content and config on disk; scaffold tools invoke the same generators as `dune generate:*`.
- **`dune add <package>`** — Add an npm or JSR package to the site's `deno.json` import map. Accepts bare names, versioned names, and explicit specifiers (`npm:`, `jsr:@scope/`).
- **`userStore: db`** — Database-backed site user store (SQLite or PostgreSQL). Requires `DUNE_DB_PATH` or `DUNE_DB_URL`.
- **`authzStore: db`** — Database-backed authorization tuple storage. The `authz_tuples` table is created automatically. Same API as `authzStore: local`.
- **`POST /auth/webhook`** — IdP user-lifecycle webhook. Active in `external-jwt + authzStore: local` mode. Handles `user.deleted` events by revoking all authorization tuples for the deleted user. Supports Clerk, Auth0, and generic HMAC-signed payloads.
- **Authz tuple HMAC integrity** — `authzStore: local` tuple files are signed with a per-installation HMAC key; tampered files are rejected on load.
- **Dev-mode email preview** — In development, all outgoing emails are intercepted and stored in `runtimeDir/dev-email/` rather than sent. Browse at `/admin/email-preview` or via `GET /admin/api/email-preview`.
- **`dune generate:admin-route <name>`** — Scaffold a custom admin panel route with handler stub and auth guard.
- **`dune validate` skill-code sync check** — Validates that `.claude/skills/` files match the versions bundled in the installed package.

---

## [0.12.0] — 2026-05-16

### Added

- **Polizy-backed authorization** — relationship-based access control via [polizy](https://github.com/bratsos/polizy). `createDuneAuthSystem()` returns an `authz` handle with `check()`, `allow()`, `addMember()`, and `delete()`. Admin permissions are now enforced through `authz.check()` rather than static role constants. Configure via `auth.authzStore` in `site.yaml`.
- **`auth.mode: external-jwt` with local authz** — combine an external identity provider (via JWT) for authentication with Dune's polizy authz store for authorization. Role tuples are seeded from JWT claims on first sign-in and kept in sync on role changes.
- **`@dune/core/auth/authz` export** — `AuthzLocalAdapter` and related types are now part of the public package surface.

---

## [0.11.0] — 2026-05-15

### Added

- **Public site user authentication** — OAuth providers (GitHub, Google, Discord), magic-link email, and external JWT. Configurable under `auth:` in `site.yaml`. Exposes `SiteUser` to templates and plugins via the auth context.
- **Role-based content gating** — `roles:` frontmatter key restricts pages to specific roles. Unauthenticated visitors are redirected; unauthorized users receive 403.
- **DB schema layer** — Schema-first data modelling via `schema:` YAML files. `Repository<T>` API with `create`, `find`, `findOne`, `update`, `delete`, `count`, and `upsert`. Adapters for Deno KV, SQLite, and PostgreSQL. Schema migrations via `dune migrate:generate`, `migrate:run`, and `migrate:status`.
- **CRUD API generation** — `dune generate:schema <name>` scaffolds schema YAML, repository, and API route handler in one step.
- **Session and rate-limit store abstraction** — Session and rate-limit counters are backed by pluggable store interfaces (KV and Redis implementations), enabling multi-process and multi-machine deployments.
- **Payments** — `PaymentProvider` plugin interface with a Stripe implementation. Covers checkout session creation, webhook handling (role assignment on successful payment), and billing portal. Configurable under `payments:` in `site.yaml`.
- **Public file upload** — `POST /api/upload` endpoint with configurable size limits, allowed types, and storage subpath. Secured by optional auth and per-type permission.
- **Runtime feature flags** — `flag(name)` and `allFlags()` helpers; `env:` value syntax reads flags from environment variables at runtime. Configurable under `flags:` in `site.yaml`.
- **Transactional email** — `email.send()` plugin API with Markdown template support. Provider implementations for SMTP, Resend, Postmark, SendGrid, and a console (dev) sink. Configurable under `email:` in `site.yaml`.
- **Search improvements** — Configurable per-field weights, faceted search (config + API + response), snippet highlights, configurable `excerpt_length`, and Flex Object indexing. Existing `GET /api/search` response extended with `facets` and `highlights` fields.
- **CDN cache invalidation** — Plugin hooks trigger cache purge requests on content publish/update. Built-in support for Cloudflare, Fastly, Bunny, and a custom webhook target. Configurable under `system.cdn`.
- **Zero-downtime graceful shutdown** — The server drains in-flight requests before exiting. Drain timeout is configurable; integrates with systemd, Docker, Kubernetes, and Fly.io lifecycle hooks.
- **Structured logging** — Configurable log format (`text` or `json`), log level (`debug`, `info`, `warn`, `error`), and per-environment overrides. JSON output includes request IDs and trace correlation. Configurable under `system.logging`.
- **Distributed tracing** — OTLP trace export to any compatible backend (Jaeger, Tempo, Honeycomb, Datadog). Configurable sampling rate and service name under `system.tracing`. Log entries include `traceId` for correlation.
- **Backup and restore** — `dune backup` archives content, config, flex data, schemas, and uploads to a timestamped `.tar.gz`. `dune restore <file>` unpacks into the site root. Both support `--dry-run`.
- **`dune migrate:flex`** — Migrate Flex Object records to a new schema version. Supports lazy write-through (on next read) or eager migration via the CLI.
- **`dune generate:*` scaffolding** — `generate:plugin`, `generate:route`, `generate:form`, `generate:theme`, and `generate:schema` scaffold the respective component into the project.
- **`@dune/core/ui` component package** — Public-site Preact components: `SearchBar`, `LoginForm`, `ProfileCard`, `CommentSection`, `SubscriptionForm`, and `FormRenderer`. Importable from `@dune/core/ui` in theme TSX.
- **yaml-language-server schema annotation** — Generated `site.yaml` files now include a `# yaml-language-server: $schema=…` comment for in-editor validation and autocompletion.

### Security

- **OAuth account takeover via email matching** — An attacker controlling an OAuth provider account with a matching email could silently take over a local user account. Provider identity is now bound to the original sign-in provider; cross-provider email matching is blocked. (Critical)
- **Magic link tokens not enforced as single-use** — Tokens could be reused after the first redemption. A nonce store now marks tokens consumed on first use. (High)
- **Broken constant-time comparison in magic-link verification** — The HMAC comparison used a non-constant-time equality check, enabling timing-based token recovery. Replaced with `timingSafeEqual`. (High)
- **Forged site-user identity header accepted** — Requests could supply a crafted `x-dune-site-user` header to impersonate any user. The header is now stripped from all inbound requests before auth middleware runs. (High)
- **IDOR in billing portal** — The portal endpoint accepted a client-supplied Stripe customer ID, allowing access to another user's billing session. The stored `stripeCustomerId` is now used exclusively. (High)
- **Stripe webhook replay attack** — Webhook events lacked timestamp validation, allowing indefinite replay of captured events. Stripe's `Webhook-Timestamp` header is now validated against a configurable tolerance window. (High)
- **Upload path traversal via URL-normalisation** — URL-encoded path components in the upload subpath could escape the configured storage directory after normalisation. The resolved path is now containment-checked against the storage root. (High)
- **Open-redirect in auth callback** — The `next` query parameter in auth flows was not validated, enabling redirect to an arbitrary external URL after login. `sanitizeNext()` now restricts the target to same-origin paths. (Medium)
- **Magic links usable without `DUNE_AUTH_SECRET`** — If the secret was absent, magic links fell back to an insecure derivation. Startup now aborts if magic links are enabled and `DUNE_AUTH_SECRET` is not set. (Medium)
- **Email template value injection** — Interpolated values in Markdown email templates were rendered without escaping, allowing injection of arbitrary Markdown or HTML. Values are now HTML-escaped before interpolation. (Medium)
- **Redis rate-limit counter race condition** — `INCR` followed by `EXPIRE` was not atomic; a crash between the two commands left keys without TTL. Replaced with a single `SET NX EX` command. (Medium)
- **Raw SQL in PostgreSQL adapter error messages** — Failed query errors included the full SQL statement, which could leak schema or data details in logs. Error messages are now scrubbed to query type and table name only. (Low)
- **Tracing `currentTraceId` not request-scoped** — The tracer uses a closure-level variable for `currentTraceId`; under concurrent requests the value reflects the most-recently-started span across all in-flight requests. Documented as best-effort log correlation; an `AsyncLocalStorage`-based fix is tracked for a future release. (Low)

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
