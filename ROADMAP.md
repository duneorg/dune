# Dune CMS — Product Roadmap

---

## Release Philosophy

Each version should be **independently useful**. v0.1 is a working headless CMS with CLI authoring. v0.2 adds visual editing. Each release is a complete product for its scope, not a stepping stone.

---

## v0.1 — Core Engine (CLI-Driven Flat-File CMS) ✅

**Theme:** "The engine that works"

**Status:** Complete

**Target:** Developers who want a programmable flat-file CMS for Deno Fresh. Content authored in editors/IDEs, managed via CLI.

### Deliverables
- **Multi-format content engine** — `.md` (Markdown) and `.tsx` (JSX) content files interchangeably
  - Pluggable `ContentFormatHandler` system (adding `.mdx` in v0.2 is just a new handler)
  - `.md`: YAML frontmatter + Markdown → HTML → theme template
  - `.tsx`: exported frontmatter (or sidecar YAML) + JSX component → self-rendering with layout control
- Content index (lazy-built, incrementally updated, format-aware)
- Routing engine (folder → URL, custom routes, redirects, aliases — format-agnostic)
- Configuration system (5-tier merge, env detection, schema validation, inspector CLI)
- Theme engine (JSX/TSX templates, theme inheritance, layout system for TSX content pages)
- Collection engine (declarative frontmatter queries, taxonomy index, chaining — works across formats)
- Storage abstraction (filesystem + Deno KV adapters)
- REST API (11 endpoints — format-aware responses for pages, collections, taxonomy, search, nav)
- Search index (full-text, incrementally updated, indexes both `.md` and `.tsx` frontmatter)
- Hook system (lifecycle events, plugin registration)
- CLI (`dune new`, `dev`, `build`, `serve`, `cache:*`, `config:*`, `content:*`, `sync`)
- Default starter theme (with example `.md` and `.tsx` content pages)
- Media serving (co-located files + sidecar metadata)

### Success Criteria
- `dune new` creates working site in <5 seconds (with both `.md` and `.tsx` examples)
- 500-page site (mixed formats) indexes in <2 seconds
- Page load <50ms cached, <200ms uncached (both formats)
- `.md` and `.tsx` pages work identically in collections, taxonomy, API, and navigation
- Works on local filesystem AND Deno Deploy with KV
- REST API enables full headless usage

---

## v0.2 — Admin Panel & Visual Editing ✅

**Theme:** "Content editors can use this"

**Status:** Complete

**Target:** Non-technical content editors. Agencies building sites for clients.

### Deliverables

#### Admin Panel (Fresh-based)
- Dashboard (site overview, recent changes, system status)
- Page tree view (visual hierarchy with drag-and-drop reordering)
- Page editor with block-based editing (stores as Markdown)
- Blueprint-driven custom fields (YAML → auto-generated admin forms)
- Centralized media library (index across all pages, search, upload, metadata editing)
- Configuration editor (visual, with schema-aware validation)
- User management (accounts, roles: admin / editor / author)
- Session-based authentication (local accounts, SSO deferred)
- Mobile-responsive admin UI

#### MDX Content Format (`.mdx`)
- Third content format: Markdown with embedded JSX components
- MDX compilation via @mdx-js/mdx (npm: specifier)
- Component registry: theme islands, plugin components available in MDX
- Same frontmatter, routing, collections as `.md` — just richer content
- Completes the content format spectrum: `.md` → `.mdx` → `.tsx`

#### Block Editor
- Paragraph, heading, list, quote, code, image, divider, table blocks
- Markdown source view toggle
- Live preview (rendered with actual theme template)
- Drag-and-drop block reordering
- Block-to-markdown serialization (content stays portable)

#### Content Workflow
- Page status: Draft → In Review → Published → Archived
- Scheduled publishing/unpublishing (Deno cron)
- Content history (stored as diffs, viewable in admin)
- Revision comparison (visual diff between versions)

#### Image Processing Pipeline
- On-the-fly resize, crop, quality via URL parameters
- `image.jpg?width=800&height=400&quality=80&format=webp`
- Responsive image generation (srcset with configurable breakpoints)
- Focal point cropping (from `.meta.yaml` or admin UI)
- Processed image caching
- WebP/AVIF auto-conversion

#### Multilingual Improvements
- Translation status dashboard (which pages need translation updates)
- Side-by-side editing (original + translation)
- `dune content:i18n-status` CLI
- Fallback chain configuration and documentation
- Translation memory (suggest previously translated phrases)

### Success Criteria
- Non-technical user can create and publish a page without Markdown knowledge
- Media library finds any asset across all pages
- Block editor round-trips through Markdown without data loss
- Admin loads in <1 second, works on mobile
- Content workflow prevents accidental publishing

---

## v0.3 — Plugin Ecosystem & Custom Types ✅

**Theme:** "Extensible and composable"

**Status:** Complete

**Target:** Plugin developers, agencies building custom solutions, power users.

### Deliverables

#### Plugin System (Full)
- Plugin scaffolding CLI (`dune plugin:create`)
- Plugin configuration with blueprint-driven admin forms
- Plugin-provided templates, islands, static assets
- Plugin dependency resolution
- Plugin API stability guarantees (semver)

#### JSR Distribution
- `dune plugin:publish` → publishes to JSR
- `dune plugin:install @scope/plugin-name` → installs from JSR
- Plugin discovery via JSR search
- Version management and update notifications

#### Flex Objects (Custom Content Types)
- Define custom data types beyond pages (products, team members, events, etc.)
- YAML schema definition → auto-generated admin CRUD UI
- Storage backends: file-per-object, single-file collection, or Deno KV
- REST API endpoints auto-generated per type
- Template integration (custom TSX components per type)
- Collection queries work across Flex types

#### Form Handling
- Contact forms, surveys, data collection
- Form blueprint definitions (YAML → rendered form)
- Submission storage (flat file or KV)
- Email notifications on submission
- Anti-spam (honeypot, rate limiting)
- File upload handling

#### Content Versioning UI
- Visual revision history timeline
- One-click rollback to any previous version
- Branch-like content staging (preview changes before publishing)
- Git integration (optional: auto-commit on save via admin)

### Success Criteria
- A developer can create, test, and publish a plugin in under 30 minutes
- Custom content type with admin CRUD UI from a single YAML file
- Form submissions stored and queryable without any code
- Plugin install from JSR is one command

---

## v0.4 — Collaboration & Advanced Features ✅

**Theme:** "Team-ready"

**Status:** Complete

**Target:** Teams, organizations, multi-author publications.

### Deliverables

#### Real-Time Collaboration ✅
- WebSocket-based concurrent editing
- Presence indicators (who is editing what, per-user color slots)
- Conflict resolution via Operational Transform (Quill Delta format)
- Change attribution (author recorded on auto-save to revision history)

#### Advanced Search ✅
- Faceted search (filter by taxonomy, date range, content type)
- Search suggestions / autocomplete
- Search analytics (query logging, popular terms dashboard)
- Custom field indexing configuration

#### Webhooks & Integrations ✅
- Outbound webhooks on content events (create, update, publish, delete)
- Configurable webhook endpoints per event type
- Delivery log with retry tracking
- _(Incoming webhooks deferred to v0.5)_

#### Comments & Annotations ✅
- Internal comments on pages (team discussion, not public)
- Comment threads with resolution status
- _(Inline block annotations and @mention notifications deferred to v0.5)_

#### Multi-Site Management ✅
- Single Dune installation serving multiple sites
- Shared theme and plugin pool
- Per-site configuration, content, and user management
- Cross-site collection queries (`@site.children`, `@site.descendants`)

#### Media Management ✅ _(beyond original plan)_
- Media upload directly from admin (media library and page editor sidebar)
- Media delete with sidecar cleanup
- File-type pages: pages with `file:` frontmatter redirect to their co-located
  file at the routing layer — templates need no special handling
- Page creation dialog supports a "File" mode (upload + create in one step)

### Success Criteria
- ✅ Two editors can edit the same page simultaneously without conflicts
- ✅ Webhook fires within 1 second of content event
- ✅ Multi-site setup serves 3+ sites from one installation

---

## v0.5 — Performance & Enterprise

**Theme:** "Production-grade at scale"

**Target:** High-traffic sites, enterprise deployments, agencies managing many sites.

### Deliverables

#### Static Site Generation (SSG)
- `dune build --static` generates a fully static site
- Incremental static regeneration (rebuild only changed pages)
- Deploy to any static host (Netlify, Cloudflare Pages, S3, etc.)
- Hybrid mode: static pages + dynamic API endpoints

#### Advanced Caching
- Edge caching strategies for Deno Deploy
- Stale-while-revalidate patterns
- Cache warming on deploy
- Per-route cache policy configuration
- Cache analytics (hit rates, invalidation frequency)

#### Performance Monitoring
- Built-in performance dashboard
- Page render time tracking
- Slow query identification (collections, search)
- Memory usage monitoring
- Lighthouse score tracking per page

#### Enterprise Features
- LDAP/SAML SSO integration
- Audit logging (who did what, when, from where)
- Content approval workflows (configurable multi-stage)
- Role-based access control with granular permissions
- Content scheduling calendar view
- Backup and disaster recovery tools

#### Internationalization (Full)
- Machine translation integration (optional, via API)
- Translation project management
- Locale-specific formatting (dates, numbers, currencies)
- RTL language support
- Per-locale SEO configuration

### Success Criteria
- 10,000-page site builds statically in <60 seconds
- Edge-cached pages serve in <20ms globally
- SSO login works with major identity providers
- Audit log captures every admin action

---

## v1.0 — Stable Release

**Theme:** "Ready for everything"

**Target:** General availability. Stable APIs. Long-term support.

### Deliverables

#### API Stability
- All public APIs frozen (semver major for breaking changes)
- Migration guides for any pre-1.0 breaking changes
- TypeScript types published as stable JSR packages
- Plugin API compatibility guarantees

#### Visual Page Builder
- Drag-and-drop page composition from modular sections
- Pre-built section library (hero, features, testimonials, CTA, gallery, etc.)
- Custom section creation (blueprint-defined)
- Responsive preview (desktop/tablet/mobile)
- Theme-aware rendering (sections use theme styles)

#### Marketplace
- Official plugin/theme directory (web UI)
- Ratings, reviews, download counts
- Verified publisher badges
- Automated compatibility testing
- Revenue sharing for premium plugins/themes (optional)

#### Documentation Site
- Interactive tutorials
- Video walkthroughs
- API reference (auto-generated from TypeScript types)
- Plugin development guide
- Theme development guide
- Deployment guides per platform
- Cookbook (recipes for common patterns)

#### Migration Tools
- `dune migrate:from-grav` — import GRAV content, config, and structure
- `dune migrate:from-wordpress` — import WordPress export XML
- `dune migrate:from-markdown` — import generic markdown folder structure
- `dune migrate:from-hugo` — import Hugo content

### Success Criteria
- No breaking API changes without major version bump
- Migration from GRAV preserves all content and structure
- Marketplace has 50+ plugins and 20+ themes at launch
- Documentation covers every feature with examples

---

## Beyond v1.0 — Future Vision

### Potential Directions (Not Committed)

- **AI-Assisted Content:** Writing assistance, auto-tagging, content suggestions, image alt text generation
- **GraphQL API:** Alternative to REST for complex queries
- **E-Commerce Module:** Products, cart, checkout (Flex Objects-based)
- **Headless CMS Platform:** Multi-tenant cloud hosting (Dune Cloud)
- **Desktop App:** Electron/Tauri wrapper for local-first editing
- **Mobile App:** Native iOS/Android for on-the-go content management
- **Content Analytics:** Built-in privacy-respecting analytics (no external services)
- **A/B Testing:** Content variant testing with statistical analysis
- **Content AI:** Embeddings-based content recommendations and related posts

---

## Timeline (Estimated)

| Version | Scope | Estimated Duration |
|---------|-------|-------------------|
| v0.1 | Core Engine | 5-6 weeks |
| v0.2 | Admin Panel & Visual Editing | 8-10 weeks |
| v0.3 | Plugin Ecosystem & Custom Types | 6-8 weeks |
| v0.4 | Collaboration & Advanced Features | 8-10 weeks |
| v0.5 | Performance & Enterprise | 6-8 weeks |
| v1.0 | Stable Release | 4-6 weeks (polish + docs) |

**Total estimated time to v1.0:** ~40-50 weeks (~10-12 months)

These estimates assume a single developer working part-time. With more contributors, timelines compress significantly.

---

## Principles Guiding the Roadmap

1. **Each version is shippable.** No "foundation-only" releases. Every version is a complete product.
2. **API stability increases with each version.** v0.x allows breaking changes. v1.0 freezes public APIs.
3. **Community feedback shapes priorities.** The order of v0.3/v0.4/v0.5 may shift based on user needs.
4. **Performance is not a phase.** Every version must meet its performance criteria. No "we'll optimize later."
5. **Avoid GRAV's mistakes from day one.** The content index, lazy loading, API-first design, and storage abstraction are in v0.1, not bolted on later.
