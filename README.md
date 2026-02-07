# Dune

A flat-file CMS built on [Deno](https://deno.land/) and [Fresh 2](https://fresh.deno.dev/). Content is files. No database required.

> **Status: v0.1 — Core Engine**
> Fully functional CLI-driven flat-file CMS. Create, develop, and serve content sites.

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

- **Content is files.** Markdown for prose, TSX for interactive pages. No database, no migration scripts.
- **Folder = page.** Directory structure IS your site structure. Numeric prefixes control order.
- **Frontmatter = config.** YAML metadata controls titles, taxonomies, collections, caching, and routing.
- **Lazy everything.** A content index handles routing and queries without loading page bodies.
- **Multi-format.** `.md` and `.tsx` interchangeably in the same site, sharing the same collections and taxonomy system.
- **API-first.** Every content operation available via REST (11 endpoints).
- **Edge-ready.** Filesystem for local dev, Deno KV for Deno Deploy — same engine, same content.

## Quick start

```bash
# Create a new site
deno run -A jsr:@dune/cms new my-site

# Start dev server
cd my-site
deno task dev
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `dune new [dir]` | Scaffold a new site with starter theme |
| `dune dev` | Dev server with hot-reload (watches content + themes) |
| `dune build` | Build content index, validate config |
| `dune serve` | Production server |
| `dune cache:clear` | Clear all caches |
| `dune cache:rebuild` | Rebuild content index from scratch |
| `dune config:show` | Display merged config with source annotations |
| `dune config:validate` | Validate all config files |
| `dune content:list` | List all pages with routes and templates |
| `dune content:check` | Check content for broken links, missing templates |

## REST API

| Endpoint | Description |
|----------|-------------|
| `GET /api/pages` | List all pages (filterable, paginated) |
| `GET /api/pages/:path` | Get single page with rendered HTML |
| `GET /api/pages/:path/children` | Get child pages |
| `GET /api/pages/:path/media` | Get co-located media files |
| `GET /api/collections` | Query collections via URL params |
| `GET /api/taxonomy` | List all taxonomies with value counts |
| `GET /api/taxonomy/:name` | Get values for a taxonomy |
| `GET /api/taxonomy/:name/:value` | Get pages for a taxonomy value |
| `GET /api/search?q=term` | Full-text search |
| `GET /api/config/site` | Public site configuration |
| `GET /api/nav` | Navigation tree (ordered, visible pages) |

## Project structure

```
dune/
├── src/                    # Engine source (TypeScript)
│   ├── core/               #   DuneEngine orchestrator, error types
│   ├── storage/            #   Storage abstraction (filesystem, KV)
│   ├── config/             #   Config loading, merging, validation
│   ├── content/            #   Content types, format handlers, index builder, page loader
│   │   └── formats/        #     Pluggable: MarkdownHandler, TsxHandler
│   ├── routing/            #   Route resolver, Fresh integration, HTTP handlers
│   ├── themes/             #   Theme discovery, inheritance, template/layout loading
│   ├── collections/        #   Declarative page queries with chainable modifiers
│   ├── taxonomy/           #   Taxonomy query engine (find, findAll, findAny)
│   ├── search/             #   Full-text search with relevance scoring
│   ├── hooks/              #   Plugin lifecycle events
│   ├── api/                #   REST API handlers (11 endpoints)
│   ├── cli/                #   CLI command implementations
│   ├── cli.ts              #   CLI entry point
│   └── mod.ts              #   Package entry point
├── tests/                  # Test suite (75 tests)
├── docs/                   # Documentation as a Dune site (dogfood)
│   ├── config/site.yaml
│   ├── content/            #   30 pages across 7 sections
│   ├── themes/default/     #   Documentation theme
│   └── main.ts             #   Standalone docs server entry point
├── PRD.md                  # Product requirements (v0.1 spec)
├── ROADMAP.md              # v0.1 → v1.0 roadmap
└── RESEARCH-GRAV.md        # GRAV strengths/shortcomings analysis
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
│  (FileSystem · KV)   │
└──────────────────────┘
```

## What's built

| Module | Status | Description |
|--------|--------|-------------|
| Storage abstraction | ✅ | `StorageAdapter` interface, `FileSystemAdapter` with JSON cache + TTL |
| Config system | ✅ | 5-tier merge (defaults → YAML → env → TS → frontmatter), validation |
| Content types | ✅ | Page, PageIndex, Collection, MediaFile, ContentPageProps |
| Format registry | ✅ | Pluggable `ContentFormatHandler` — add new formats without engine changes |
| Markdown handler | ✅ | gray-matter frontmatter + marked rendering + media URL resolution |
| TSX handler | ✅ | Sidecar YAML (fast path) + AST extraction from `export const frontmatter` |
| Path utilities | ✅ | Folder conventions (`01.name/`, `_module/`, `_drafts/`), route building |
| Content index | ✅ | Full + incremental scan, taxonomy reverse map, mtime-based invalidation |
| Page loader | ✅ | Lazy memoized accessors: html, component, children, parent, siblings, summary |
| Route resolver | ✅ | URL → PageIndex with redirects, aliases, trailing slash normalization |
| Theme engine | ✅ | Theme discovery, inheritance chains, template/layout resolution + caching |
| DuneEngine | ✅ | Central orchestrator wiring storage → config → content → routing → themes |
| HTTP handlers | ✅ | Content rendering, media serving, format-aware dispatch |
| Collection engine | ✅ | Declarative queries, filter/sort/paginate, chainable modifiers |
| Taxonomy engine | ✅ | find, findAll (AND), findAny (OR), values with counts |
| Search engine | ✅ | Full-text inverted index, relevance scoring, excerpt generation |
| Hook system | ✅ | Plugin registration, lifecycle events, data pipeline |
| REST API | ✅ | 11 endpoints: pages, taxonomy, collections, search, nav, config |
| CLI | ✅ | new, dev, build, serve, cache:*, config:*, content:* |
| Default theme | ✅ | Layout shell + default template for docs site |
| Documentation | ✅ | 30-page docs site using Dune's own content model |

## What's next

See [ROADMAP.md](ROADMAP.md) for the full plan. Near-term:

- **v0.2:** Admin panel with block editor, MDX content format, image processing pipeline
- **v0.3:** Plugin ecosystem (JSR), custom content types (Flex Objects), form handling
- **v0.4:** Real-time collaboration, advanced search, webhooks
- **v0.5:** Static site generation, edge caching, enterprise features

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

The `docs/` directory is a real Dune content site — structured using Dune's own folder conventions, frontmatter, and taxonomy system. Every page is tagged by audience (`editor`, `webmaster`, `developer`) and difficulty level.

Serve the docs locally:

```bash
deno run -A src/cli.ts dev --root docs
```

## Design documents

- **[PRD.md](PRD.md)** — Full v0.1 specification: architecture, interfaces, content model, config system, routing, themes, collections, API, CLI
- **[ROADMAP.md](ROADMAP.md)** — Version plan from v0.1 through v1.0
- **[RESEARCH-GRAV.md](RESEARCH-GRAV.md)** — Analysis of GRAV CMS: what to adopt, what to avoid

## License

MIT
