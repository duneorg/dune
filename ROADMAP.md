# Dune — Roadmap

Dune is pre-1.0. The version number advances with each meaningful addition; breaking changes are documented in the [changelog](CHANGELOG.md). API stability guarantees begin at v1.0.

This document describes what is being worked on, what comes next, and the longer-term direction. It is a living document, not a commitment schedule.

---

## What ships today (v0.24)

The core is complete and in production use:

- Flat-file content engine — Markdown, MDX, TSX; ordered folders; frontmatter; co-located media
- Routing — folder-to-URL, Grav-style named page folders, flat content archives, aliases, redirects, trailing-slash canonicalisation
- Preact themes with Fresh islands — server-rendered templates, opt-in client hydration, zero JS by default
- Admin panel — page tree, block editor, media library, user management, revision history, config editor
- Collections and taxonomy — declarative frontmatter queries, faceted filtering, pagination
- Inline editing — `@dune/plugin-inline-edit` attaches a WYSIWYG editor to live pages; collaborative editing via CRDT; markers scrubbed from public responses
- Admin auth — session-based, OAuth, magic links; role-based access control; admin audit log
- Public user auth — visitor accounts via OAuth (GitHub/Google/Discord) and magic link; `dune` and `external-jwt` modes; `local`/`session`/`db` user stores; role-based content gating via `roles:` frontmatter
- Plugins — hooks API, browser entry points (client bundles), admin services, scheduled jobs
- Pluggable search — `onSearchRecordsCollect` lets plugins inject records into the index; `onSearchEngineCreate` lets plugins replace the engine entirely; `@dune/plugin-meilisearch` and `@dune/plugin-pdf` both register via `plugins:` in `site.yaml` with no code
- Replaceable admin content editor — `ContentEditorPlugin` slot in `adminServices`; plugins replace the block editor by registering `pageEditorHandler`; optional WS endpoint for real-time collaboration
- Flex objects — schema-defined custom data types with generated admin CRUD
- Database layer — SQLite/KV/Postgres backends, typed repositories, SQL migrations
- CRUD API generation — declare an `api:` block in a schema and get REST endpoints (list/get/create/update/delete) with auth and ownership checks
- Public file upload, payments (Stripe), background jobs (cron), and a configurable search engine (field weighting, facets, highlighted excerpts, Flex indexing)
- CDN cache invalidation — Fastly, Bunny, Cloudflare, and custom providers; cache-tags and purge-on-publish
- Multisite — multiple sites from one process
- CLI — `dune new`, `dev`, `serve`, `validate`, `migrate:*`, `deploy:init`, `lockfile`, `generate:*`, `jobs:*`, `plugin:install`, `plugin:create`
- MCP server — read tools (pages, search, taxonomy, config) and write tools (content/config mutations); scaffolding via `generate:*`
- Lockfile UX — `dune upgrade`/`add` auto-sync `deno.lock`; staleness hint at startup; `serve --frozen` for reproducible deploys

---

## Near-term

### Plugin ecosystem

The install workflow, marketplace UI, and JSR distribution path all exist. First-party packages published: `@dune/plugin-inline-edit` (WYSIWYG inline editing), `@dune/plugin-pdf` (PDF serving, text extraction, browser viewer), `@dune/plugin-meilisearch` (Meilisearch search backend). All three register via `plugins:` in `site.yaml` with no manual wiring.

The next first-party priorities are analytics, sitemaps, and contact forms. For `@dune/plugin-meilisearch`, the remaining work is an admin panel toggle for switching search backends at runtime and a parallel mode where both engines run simultaneously.

### 1.0

No new features for 1.0 — the milestone is an API stability guarantee. The public hook interfaces, plugin contract, content API, and CLI commands will be frozen at semver major on breaking changes. The remaining pre-1.0 work is identifying any surface areas that need cleanup before that guarantee is meaningful.

---

## Longer-term directions

These are directions, not commitments. Order reflects current thinking, not a fixed plan.

**Edge deployment.** Dune runs on any VPS today. Running on Deno Deploy requires a KV-backed storage adapter (no persistent filesystem). The storage abstraction was designed for this; the adapter has not been built. (CDN cache invalidation across edge instances already exists.)

**Alternative search backends.** The built-in engine is a configurable in-memory inverted index, and `@dune/plugin-meilisearch` provides a Meilisearch backend. Remaining: Orama and Typesense backends, and a search-engine slot that supports multiple registered engines with runtime switching.

**Replaceable admin content editor.** The block editor is currently hardwired. Making the editing UI a replaceable slot (same `adminServices` pattern as inline editing) would let sites swap in a custom editor.

**Testing infrastructure.** A plugin integration harness (`@dune/testing`), browser-level E2E coverage for the admin panel (Playwright), and isolation for TSX content pages (Worker sandbox).

---

## What is not on the roadmap

- A hosted / SaaS version of Dune
- A GraphQL API (the REST API covers the use cases)
- A desktop or mobile app

These may revisited if there is strong community interest, but they are not planned.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The most useful contributions right now are bug reports with reproduction cases, plugin development, and theme development.
