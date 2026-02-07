# Dune

A flat-file CMS built on [Deno](https://deno.land/) and [Fresh 2](https://fresh.deno.dev/). Content is files. No database required.

> **Status: Early development (v0.1 in progress)**
> Core engine foundations are built. Not yet usable for sites.

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
- **API-first.** Every content operation available via REST.
- **Edge-ready.** Filesystem for local dev, Deno KV for Deno Deploy — same engine, same content.

## Project structure

```
dune/
├── src/                    # Engine source (TypeScript)
│   ├── core/               #   Error types
│   ├── storage/            #   Storage abstraction (filesystem, KV)
│   ├── config/             #   Config loading, merging, validation
│   └── content/            #   Content types, format handlers, index builder
│       └── formats/        #     Pluggable: MarkdownHandler, TsxHandler
├── tests/                  # Test suite (75 tests)
├── docs/                   # Documentation as a Dune site (dogfood)
│   ├── config/site.yaml
│   └── content/            #   30 pages across 7 sections
├── PRD.md                  # Product requirements (v0.1 spec)
├── ROADMAP.md              # v0.1 → v1.0 roadmap
└── RESEARCH-GRAV.md        # GRAV strengths/shortcomings analysis
```

## What's built (Phase 1: Foundation)

| Module | Status | Description |
|--------|--------|-------------|
| Storage abstraction | ✅ | `StorageAdapter` interface, `FileSystemAdapter` with JSON cache + TTL |
| Config system | ✅ | 5-tier merge (defaults → YAML → env → TS → frontmatter), validation with suggestions |
| Content types | ✅ | Page, PageIndex, PageFrontmatter, Collection, MediaFile, ContentPageProps |
| Format registry | ✅ | Pluggable `ContentFormatHandler` — register new formats without engine changes |
| Markdown handler | ✅ | gray-matter frontmatter + marked rendering + media URL resolution |
| TSX handler | ✅ | Sidecar `.frontmatter.yaml` (fast path) + AST extraction from `export const frontmatter` |
| Path utilities | ✅ | Folder conventions (`01.name/`, `_module/`, `_drafts/`), route building |
| Content index | ✅ | Full + incremental scan, taxonomy reverse map, mtime-based invalidation |
| Documentation | ✅ | 30-page docs site using Dune's own content model |

## What's next

See [ROADMAP.md](ROADMAP.md) for the full plan. Near-term:

- **Phase 2:** Content engine integration (lazy page loading, collection resolver, taxonomy queries)
- **Phase 3:** Routing + Fresh 2 integration (catch-all route, template resolution, media serving)
- **Phase 4:** Theme engine (template loading, inheritance, layout wrapping)
- **Phase 5:** CLI + API (dev server, build, cache commands, REST endpoints)

## Development

Requires [Deno](https://deno.land/) 2.x.

```bash
# Run tests
deno test -A tests/

# Type-check
deno check src/**/*.ts
```

## Documentation

The `docs/` directory is a real Dune content site — structured using Dune's own folder conventions, frontmatter, and taxonomy system. Every page is tagged by audience (`editor`, `webmaster`, `developer`) and difficulty level.

Browse the docs as Markdown files, or (once the engine is complete) serve them with `dune dev` from the `docs/` directory.

## Design documents

- **[PRD.md](PRD.md)** — Full v0.1 specification: architecture, interfaces, content model, config system, routing, themes, collections, API, CLI
- **[ROADMAP.md](ROADMAP.md)** — Version plan from v0.1 through v1.0
- **[RESEARCH-GRAV.md](RESEARCH-GRAV.md)** — Analysis of GRAV CMS: what to adopt, what to avoid

## License

MIT
