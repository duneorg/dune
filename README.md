# Dune

A flat-file CMS built on [Deno](https://deno.land/) and [Preact](https://preactjs.com/). Content is files. No database required.

> **Status: v0.6** — Pre-1.0. Minor releases may include breaking changes per semver convention.

## What is Dune?

Dune takes the best ideas from [GRAV CMS](https://getgrav.org/) — folder-based content, frontmatter-driven config, declarative collections, theme inheritance — and rebuilds them for the Deno ecosystem, avoiding GRAV's pain points (full-tree scanning, PHP lock-in, weak API, memory-hungry page loading).

```
content/
├── 01.home/
│   └── default.md              # Markdown page → rendered by theme template
├── 02.blog/
│   ├── blog.md                 # Listing with declarative collection query
│   └── 01.hello-world/
│       ├── post.md             # Blog post with co-located media
│       └── cover.jpg
└── 03.landing/
    └── page.tsx                # TSX content page — full programmatic control
```

### Core ideas

- **Content is files.** Markdown, MDX, or TSX. No database, no migration scripts.
- **Folder = page.** Directory structure IS your site structure. Numeric prefixes control order.
- **Frontmatter = config.** YAML metadata controls titles, taxonomies, collections, caching, and routing.
- **Lazy everything.** A content index handles routing and queries without loading page bodies.
- **Multi-format.** `.md`, `.mdx`, and `.tsx` interchangeably in the same site.
- **API-first.** Every content operation available via REST.

## Quick start

```bash
# Create a new site
deno run -A jsr:@dune/core/cli new my-site

# Start dev server
cd my-site
deno task dev
```

## Installing the CLI

```bash
deno install --global -n dune -A jsr:@dune/core/cli
```

Make sure Deno's bin directory is in your PATH (usually `~/.deno/bin`).

To uninstall: `deno uninstall dune`

**For local development** (working on the framework itself):
```bash
deno install --global -n dune -A --import-map=deno.json src/cli.ts
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `dune new [dir]` | Scaffold a new site with starter theme |
| `dune dev` | Dev server with hot-reload (watches content + themes) |
| `dune build` | Build content index, validate config |
| `dune build --static` | Static site generation |
| `dune serve` | Production server |
| `dune migrate:from-grav <src>` | Import a Grav site |
| `dune migrate:from-wordpress <src>` | Import a WordPress WXR export |
| `dune migrate:from-hugo <src>` | Import a Hugo site |
| `dune migrate:from-markdown <src>` | Import a flat markdown folder |
| `dune cache:clear` | Clear all caches |
| `dune cache:rebuild` | Rebuild content index from scratch |
| `dune config:show` | Display merged config with source annotations |
| `dune config:validate` | Validate all config files |
| `dune content:list` | List all pages with routes and templates |
| `dune content:check` | Check content for broken links, missing templates |

## Features

### Content
- Markdown, MDX, and TSX format handlers
- YAML frontmatter, blueprint-driven custom fields
- Declarative collection queries with filter/sort/paginate
- Taxonomy system (find, findAll AND, findAny OR)
- Full-text search with relevance scoring and excerpt generation
- Revision history with visual diff
- Content workflow: draft / in_review / published / archived
- Static site generation with incremental builds

### Admin
- Block editor, media library, page tree
- Visual page builder (drag-and-drop sections)
- Multi-stage configurable workflows
- Real-time collaboration (OT-based concurrent editing)
- i18n translation management, side-by-side editing, Translation Memory
- Machine translation (DeepL, Google Translate, LibreTranslate)
- RTL language support
- Marketplace (plugin + theme discovery)

### Extending
- Plugin system (JSR-based, hook lifecycle)
- Theme SDK with inheritance and configuration schema
- Flex Objects: schema-driven custom content types
- REST API (20+ endpoints)
- Outbound and incoming webhooks
- Internal comments and @mention notifications

### Operations
- Multi-site management (hostname/path-prefix routing, shared themes)
- ETag/304, Cache-Control + SWR, in-process page cache
- Append-only audit log (15 event types)
- Performance monitoring dashboard (p50/p95/p99 latency)
- CSRF, rate limiting, security headers, path traversal protection
- Docker support

## Project structure

```
dune/
├── src/                    # Engine source (TypeScript)
│   ├── core/               #   DuneEngine orchestrator
│   ├── storage/            #   Storage abstraction (filesystem)
│   ├── config/             #   Config loading, merging, validation
│   ├── content/            #   Content types, format handlers, index builder
│   ├── routing/            #   Route resolver, HTTP handlers
│   ├── themes/             #   Theme discovery, inheritance, template loading
│   ├── collections/        #   Declarative page queries
│   ├── taxonomy/           #   Taxonomy query engine
│   ├── search/             #   Full-text search
│   ├── hooks/              #   Plugin lifecycle events
│   ├── plugins/            #   Plugin loader
│   ├── admin/              #   Admin panel and REST API
│   ├── sections/           #   Visual page builder
│   ├── cli/                #   CLI command implementations
│   ├── cli.ts              #   CLI entry point
│   └── mod.ts              #   Package entry point
├── tests/                  # Test suite
├── docs/                   # Documentation as a Dune site (dogfood)
│   ├── config/site.yaml
│   ├── content/
│   ├── themes/default/
│   └── main.ts             #   Imports from ../src
└── ROADMAP.md
```

## Architecture

```
                  ┌─────────────────────────────────┐
                  │           CLI / HTTP             │
                  │  dev · serve · build · API       │
                  └──────────────┬──────────────────┘
                                 │
                  ┌──────────────┴──────────────────┐
                  │          DuneEngine              │
                  │   (orchestrates all subsystems)  │
                  └──────────────┬──────────────────┘
                                 │
          ┌──────────┬───────────┼───────────┬──────────┐
          │          │           │           │          │
     ┌────┴────┐ ┌───┴───┐ ┌────┴────┐ ┌────┴───┐ ┌───┴────┐
     │ Content │ │ Route │ │  Theme  │ │ Search │ │ Hooks  │
     │ Engine  │ │Resolver│ │ Loader  │ │ Engine │ │Registry│
     └────┬────┘ └───────┘ └─────────┘ └────────┘ └────────┘
          │
   ┌──────┼──────────┐
   │      │          │
┌──┴──┐ ┌─┴──┐ ┌────┴────┐
│Index│ │Page│ │ Format  │
│Build│ │Load│ │ Handlers│
└──┬──┘ └────┘ └─────────┘
   │
┌──┴──────────────────┐
│  Storage Abstraction │
│  (FileSystem)        │
└──────────────────────┘
```

## Development

Requires [Deno](https://deno.land/) 2.x.

```bash
# Run tests
deno test -A tests/

# Type-check
deno check src/**/*.ts

# Start docs site dev server
deno run -A src/cli.ts dev --root docs

# Build & validate docs site
deno run -A src/cli.ts build --root docs
```

## Documentation

The `docs/` directory is a real Dune site — structured using Dune's own folder conventions, frontmatter, and taxonomy system. It imports directly from `../src`, making it a live dogfood example of the framework.

Serve the docs locally:

```bash
deno run -A src/cli.ts dev --root docs
```

## Design documents

- **[ROADMAP.md](ROADMAP.md)** — Version plan from v0.1 through v1.0

## License

MIT — © 2026 [zumbrunn](https://zumbrunn.com)
