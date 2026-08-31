# Dune — Roadmap

Dune is pre-1.0. The version number advances with each meaningful addition; breaking changes are documented in the [changelog](CHANGELOG.md). API stability guarantees begin at v1.0.

This document describes what is being worked on, what comes next, and the longer-term direction. It is a living document, not a commitment schedule.

---

## What ships today

The core is complete and in production use:

- Flat-file content engine — Markdown, MDX, TSX; ordered folders; frontmatter; co-located media
- Routing — folder-to-URL, Grav-style named page folders, flat content archives, aliases, redirects, trailing-slash canonicalisation, declarative collection pagination (`/page:N`)
- Preact themes with Fresh islands — server-rendered templates, opt-in client hydration, zero JS by default; theme packages installable via JSR/npm with inheritance across a `parent:` chain
- Generated site entrypoint (`main.ts`) — `dune new` scaffolds a one-line entrypoint that runs as the site's own process, no CLI re-exec; `dune migrate:entrypoint` moves existing sites over
- Admin panel (`@dune/plugin-admin`) — page tree, block editor, media library, user management, revision history, config editor, marketplace, per-page theme-config overrides
- Collections and taxonomy — declarative frontmatter queries, faceted filtering, pagination
- Inline editing — `@dune/plugin-inline-edit` attaches a WYSIWYG editor to live pages; collaborative editing via CRDT; markers scrubbed from public responses
- Admin auth — session-based, OAuth, magic links; polizy-backed relationship authorization; role-based access control; admin audit log
- Public user auth — visitor accounts via OAuth (GitHub/Google/Discord) and magic link; `dune` and `external-jwt` modes; `local`/`session`/`db` user stores; role-based content gating via `roles:` frontmatter; admin-provisioned accounts (`dune users:create`) alongside self-service signup; account linking — a user can connect additional OAuth providers to one existing account
- Plugins — hooks API, browser entry points (client bundles), admin services, scheduled jobs
- Pluggable search — `onSearchRecordsCollect`/`onSearchEngineCreate` hooks, multi-engine slot with runtime switching; built-in engine supports filter/sort/facet counts/pagination; `@dune/plugin-orama` (in-process, typo-tolerant) and `@dune/plugin-meilisearch` both register via `plugins:` in `site.yaml` with no code
- Replaceable admin content editor — `ContentEditorPlugin` slot in `adminServices`; plugins replace the block editor by registering `pageEditorHandler`; optional WS endpoint for real-time collaboration
- Flex objects — schema-defined custom data types with generated admin CRUD
- Database layer — SQLite/KV/Postgres backends, typed repositories, SQL migrations
- CRUD API generation — declare an `api:` block in a schema and get REST endpoints (list/get/create/update/delete) with auth and ownership checks
- Public file upload, payments (Stripe), background jobs (cron), and a configurable search engine (field weighting, facets, highlighted excerpts, Flex indexing)
- CDN cache invalidation — Fastly, Bunny, Cloudflare, and custom providers; cache-tags and purge-on-publish
- Multisite — multiple sites from one process
- Deno Deploy support — `KvStorageAdapter` (no persistent filesystem required), auto-selected via `DENO_KV_URL`
- CLI — `dune new`, `dev`, `serve`, `validate`, `build`, `migrate:*`, `deploy:init`, `lockfile:*`, `generate:*`, `jobs:*`, `plugin:*`, `theme:*`, `users:create`/`grant-role`/`revoke-role`, `content:*` (list/check/i18n-status/create/delete), `authz:sign`, `backup`/`restore`, `add`, `codegen`, `schema:export`
- MCP server — read tools (pages, search, taxonomy, config) and write tools (content/config mutations); scaffolding via `generate:*`
- Lockfile — Deno-level `--frozen` enforcement on `serve` (opt-in via `--frozen`/`DUNE_FROZEN=1`), no command implicitly writes `deno.lock`, `dune upgrade`/`add` auto-sync, staleness hint at startup
- Testing infrastructure — `@dune/testing` in-process harness (`createTestHarness()`, `h.fetch()`/`h.render()`) for plugin/theme authors; Playwright E2E suite covering the admin panel's critical paths

---

## Near-term

### Plugin ecosystem

The install workflow, marketplace UI, and JSR distribution path all exist. First-party packages published: `@dune/plugin-admin` (admin panel), `@dune/plugin-inline-edit` (WYSIWYG inline editing), `@dune/plugin-pdf` (PDF serving, text extraction, browser viewer), `@dune/plugin-meilisearch` and `@dune/plugin-orama` (search backends, runtime-switchable via the multi-engine slot and an admin panel toggle). All register via `plugins:` in `site.yaml` with no manual wiring.

The next first-party priorities are analytics, sitemaps, and contact forms.

### 1.0

No new features for 1.0 — the milestone is an API stability guarantee. The public hook interfaces, plugin contract, content API, and CLI commands will be frozen at semver major on breaking changes. What "breaking" means is now written down in [VERSIONING.md](VERSIONING.md).

Two concrete things remain before the cutover:

- **`BootstrapResult` service-locator cleanup.** Flagged during the pre-1.0 architecture review (v0.26) and explicitly deferred — it's still a flat bag of 17+ unrelated fields (and has grown since, not shrunk). Needs typed phases/sub-contexts; deferred specifically because it requires wider plugin API changes, so it should land deliberately as part of the 1.0 surface review, not incrementally.
- **Re-pin all four first-party plugins from `jsr:@dune/core@0` to `^1.0.0`**, in lockstep with the actual 1.0.0 release — they cannot publish against a 1.0.0 core with a stale `@0` range (JSR's floor-compatibility check on a bare `0` range validates against `0.0.0`, which was never really true for any of them). This is what's currently blocking `plugin-admin`'s JSR publish.

---

## Longer-term directions

These are directions, not commitments. Order reflects current thinking, not a fixed plan.

**Alternative search backends.** The built-in engine, `@dune/plugin-meilisearch`, and `@dune/plugin-orama` (in-process, typo-tolerant) all exist behind the multi-engine slot with runtime switching. Remaining: a Typesense backend, and — lower priority, given licensing/pricing implications — an Algolia one. Orama index persistence is blocked on an upstream bug (`@orama/orama`'s `load()` throws as of 3.1.18).

**TSX content page sandboxing.** The current author-trust gate (TSX restricted to admin role via `content.allowTsxFormat`) is a mitigation, not the real fix — proper isolation (likely a Deno Worker with a capability allowlist) needs a design decision before implementation.

**Media storage for Deno Deploy.** The KV storage adapter covers page content and small assets; binary media (images, video, uploads) needs an R2/S3-compatible object-storage adapter, since Deno KV has per-value size limits.

---

## What is not on the roadmap

- A hosted / SaaS version of Dune
- A GraphQL API (the REST API covers the use cases)
- A desktop or mobile app

These may revisited if there is strong community interest, but they are not planned.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The most useful contributions right now are bug reports with reproduction cases, plugin development, and theme development.
