# Dune — Roadmap

Dune is pre-1.0. The version number advances with each meaningful addition; breaking changes are documented in the [changelog](CHANGELOG.md). API stability guarantees begin at v1.0.

This document describes what is being worked on, what comes next, and the longer-term direction. It is a living document, not a commitment schedule.

---

## What ships today (v0.19)

The core is complete and in production use:

- Flat-file content engine — Markdown, MDX, TSX; ordered folders; frontmatter; co-located media
- Routing — folder-to-URL, Grav-style named page folders, flat content archives, aliases, redirects
- Preact themes with Fresh islands — server-rendered templates, opt-in client hydration, zero JS by default
- Admin panel — page tree, block editor, media library, user management, revision history, config editor
- Collections and taxonomy — declarative frontmatter queries, faceted filtering, pagination
- Inline editing — `@dune/plugin-inline-edit` attaches a WYSIWYG editor to live pages; collaborative editing via CRDT; markers scrubbed from public responses
- Auth — session-based, OAuth, magic links; role-based access control; admin audit log
- Plugins — hooks API, browser entry points (client bundles), admin services, scheduled jobs
- Flex objects — schema-defined custom data types with generated admin CRUD
- Multisite — multiple sites from one process
- CLI — `dune new`, `dev`, `serve`, `validate`, `migrate:*`, `deploy:init`, MCP server
- Database layer — SQLite/KV/Postgres backends, typed repositories, SQL migrations

---

## Near-term

### Public user authentication

The admin panel has full authentication. What is missing is authentication for the *public site* — visitor accounts, signup, login, password reset, session management, and role-based content gating for end users. This is the prerequisite for most application-tier features (members-only content, user-generated data, personalisation, payments).

### Plugin ecosystem

The install workflow, marketplace UI, and JSR distribution path all exist. The gap is the plugins themselves. First-party plugins for analytics, sitemaps, and contact forms are the immediate priority.

### 1.0

No new features for 1.0 — the milestone is an API stability guarantee. The public hook interfaces, plugin contract, content API, and CLI commands will be frozen at semver major on breaking changes. The remaining pre-1.0 work is identifying any surface areas that need cleanup before that guarantee is meaningful.

---

## Longer-term directions

These are directions, not commitments. Order reflects current thinking, not a fixed plan.

**Edge deployment.** Dune runs on any VPS today. Running on Deno Deploy requires a KV-backed storage adapter (no persistent filesystem) and distributed cache invalidation across edge instances. The storage abstraction was designed for this; the adapter has not been built.

**Search.** The current engine is an in-memory inverted index. Flex object indexing, field weighting, and pluggable backends (Orama, Meilisearch, Typesense) are the main gaps.

**Content delivery.** CDN cache invalidation hooks, cache-tag headers, and purge-on-publish integration with major providers.

**Application primitives.** File upload for public users, payment processing (Flex Objects-based), and CRUD API generation from schema definitions.

---

## What is not on the roadmap

- A hosted / SaaS version of Dune
- A GraphQL API (the REST API covers the use cases)
- A desktop or mobile app

These may revisited if there is strong community interest, but they are not planned.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The most useful contributions right now are bug reports with reproduction cases, plugin development, and theme development.
