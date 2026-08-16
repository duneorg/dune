# Skill: dune-mcp — MCP Server Integration

Connects AI coding agents to a live Dune content engine via the Model Context Protocol. **`dune mcp:serve` is not read-only.** It registers 9 real read-write/scaffold tools by default alongside the read tools — no opt-in flag required. If you've been told "content mutations require the admin API," that's wrong; the write tools below are the direct, no-HTTP-server-needed path.

## Security model — no auth of its own

The server has **no authentication** — any process that can write to its stdin can call every tool, including the write ones. The example configs below run it with `deno -A` (all permissions), so tools execute with your full user privileges: they can read/write files and reach the network. `install_plugin`/`update_config` modify `site.yaml`, which controls what code your site runs later — treat MCP tool access as equivalent to code execution. Only connect it to agents/machines you trust, and never bridge its stdio to a network socket. To reduce blast radius, replace `-A` with narrower flags:

```json
"args": [
  "run",
  "--allow-read=.", "--allow-write=.", "--allow-env", "--allow-net=jsr.io",
  "jsr:@dune/core/cli", "mcp:serve"
]
```

## Setup

Add to `.mcp.json` (project) or `~/.claude.json` (global):

```json
{
  "mcpServers": {
    "dune": {
      "command": "deno",
      "args": ["run", "-A", "jsr:@dune/core/cli", "mcp:serve"],
      "cwd": "/path/to/site"
    }
  }
}
```

Or with local source:
```json
{
  "mcpServers": {
    "dune": {
      "command": "deno",
      "args": ["run", "-A", "/path/to/dune/src/cli.ts", "mcp:serve", "--root", "/path/to/site"]
    }
  }
}
```

## CLI options

```
dune mcp:serve [options]

  --root <dir>    Site root directory (default: current directory)
  --debug         Log debug info to stderr
  --no-search     Skip building the search index (faster startup, disables search_content)
```

On startup, the server logs `MCP server ready — N tools (R read, W write/scaffold), M resources` — a quick way to confirm write tools loaded.

## Available read tools

### `list_pages`
List pages in the content index.

```json
{
  "template": "blog",          // filter by template
  "published": true,           // filter by status
  "language": "en",            // filter by language
  "taxonomy": {"tag": ["deno"]}, // filter by taxonomy
  "date_from": "2024-01-01",   // filter by date
  "date_to": "2024-12-31",
  "limit": 50,                 // max results (default 50, max 500)
  "offset": 0                  // pagination
}
```
Returns: `{ total, limit, offset, pages: [{ route, title, date, template, format, published, language, taxonomy, sourcePath }] }`

### `get_page`
Get full page data including frontmatter, rendered HTML, and media.

```json
{
  "route": "/blog/hello-world",
  "include_html": true          // include rendered HTML body (default true)
}
```
Returns: `route`, `title`, `date`, `template`, `format`, `published`, `language`, `sourcePath`, `frontmatter`, `media[]`, `html` (or `null` + `htmlError` if rendering failed).

### `get_page_source`
**Not in the original doc — a real tool.** Read raw source content (frontmatter + body) by route, without a running admin server. This is the MCP-native equivalent of `GET /admin/api/page-source` — prefer it over the HTTP endpoint when you're already inside the MCP session.

```json
{ "route": "/blog/hello-world" }
```

### `search_content`
Full-text search across all pages. Requires the search index (`--no-search` disables this tool).

```json
{
  "query": "deno fresh routing",
  "limit": 10,                  // max results (default 10, max 50)
  "template": "blog",           // restrict to template
  "language": "en"              // restrict to language
}
```
Returns: `{ query, total, results: [{ route, title, date, template, language, score, excerpt }] }`

### `get_taxonomy`
Get taxonomy values with page counts.

```json
{ "name": "category" }  // omit to list all taxonomies (returns { taxonomies: { name: count } })
```

### `get_config`
Get site configuration summary (no secrets).

Returns: `site` (title, url, author, taxonomies, feedEnabled, workflowEnabled), `theme` (name, templates, layouts), `system` (contentDir, languages, cacheEnabled, debugMode), `admin` (path, auditEnabled), `plugins` (list of specs).

### `get_runtime_info`
Live snapshot: page counts (total/published/draft), formats breakdown, top-level route sections, taxonomy summaries (with top values), theme name/version/templates/layouts, `generatedAt`.

### `list_templates`
List all templates and layouts in the active theme.

### `list_blueprints`
**Not in the original doc — a real tool.** List frontmatter blueprint schemas — the MCP-native equivalent of `dune blueprint:list`/`dune blueprint:show`, no CLI shell-out needed.

```json
{ "template": "blog-post" }  // omit to list all; with a template, returns its full resolved field schema
```
Without `template`: `{ total, blueprints: [{ template, title, requiredFields, optionalFields, fieldCount }] }`. With `template`: `{ template, title, fields: { [name]: { type, label, required, default?, options?, validate? } } }`.

## Available write/scaffold tools

**These are real and registered by default — the previous version of this doc claimed no such tools exist.**

### `write_page`
Write or overwrite a content file.
```json
{ "path": "blog/hello.md", "content": "---\ntitle: Hello\n---\n\nBody text" }
```
`path` is relative to the content directory; `content` is the full file including frontmatter. Written as-is — no YAML/frontmatter parsing or validation happens before the write, so malformed frontmatter lands on disk exactly as given.

### `delete_page`
Delete a content file by route (preferred) or path.
```json
{ "route": "/blog/hello" }
```

### `update_frontmatter`
Merge frontmatter fields into an existing page without touching the body. `null` removes a field.
```json
{ "route": "/blog/hello", "updates": { "published": true, "draft": null } }
```
Use `path` instead of `route` for a page just written in the same session — the engine index won't know about it yet.

### `update_config`
Deep-merge fields into `site.yaml`.
```json
{ "updates": { "site": { "title": "New title" } } }
```
Read current values with `get_config` first — this doesn't show you a diff.

### `install_plugin`
Add a plugin specifier to `site.yaml`'s `plugins:` list (no-ops if already present).
```json
{ "src": "jsr:@dune/plugin-meilisearch@^0.3" }
```

### `scaffold_plugin` / `scaffold_route` / `scaffold_theme`
Generate a plugin at `plugins/{name}/index.ts`, a content page at `content/{name}.md`, or a theme at `themes/{name}/` — same output as the equivalent `dune generate:*` CLI commands, callable directly from the MCP session.
```json
{ "name": "my-analytics" }
```

### `scaffold_form`
Generates a form definition at `forms/{name}.yaml` (`dune generate:form` under the hood) — `title:` + `fields` with types like `email`/`textarea`, consumed by `src/forms/loader.ts` at runtime for `GET`/`POST /api/forms/:name`. **Not the same directory as the DB data-layer's `schemas/*.yaml`** (`dune-schemas` skill — `model:`/`fields` with `string`/`text`/`integer`/etc. types, no `title:`). Read the existing directory with `dune://content/forms` (see Resources) before scaffolding to avoid name collisions.

None of the 9 write/scaffold tools are exported from `@dune/core/mcp`'s public module (`buildWriteTools` isn't in `mod.ts`) — they're wired up internally by the `dune mcp:serve` CLI command only. A programmatic embedding (see "Programmatic Use" below) gets read tools and resources via the public API, not write tools, unless you import `write-tools.ts` by its internal path (unsupported).

## Available Resources

| URI | Description |
|-----|-------------|
| `dune://site/config` | Full site.yaml config (secrets omitted) |
| `dune://site/schema` | JSON Schema draft-07 for site.yaml |
| `dune://content/pages` | Complete page index as JSON |
| `dune://content/taxonomy` | All taxonomy values with counts |
| `dune://content/blueprints` | All frontmatter blueprint definitions, inheritance resolved |
| `dune://content/forms` | All form definitions under `forms/` — read this before `scaffold_form` |
| `dune://site/audit` | Last 50 admin audit-log entries (empty array if audit logging isn't enabled) |

The last three aren't in the original version of this doc. `dune mcp:serve` registers all 7. A programmatic embedding only gets `forms`/`audit` if it passes `storage` and `root` to `buildResources()` (both optional — omit either and you get 5 resources, not 7, with no error).

## HTTP API — Content Read/Write

These REST endpoints complement the MCP tools (largely superseded by `get_page_source`/`write_page`/etc. above when you're inside an MCP session, but still relevant for non-MCP tooling or CI).
All require authentication; `dev/apply` additionally requires `DUNE_ENV=dev` or `system.debug: true`.

### `GET /admin/api/page-source?route=/blog/post`
Read raw source content for a page by its route.
Returns: `{ route, sourcePath, format, content, frontmatter, body, mtime }`

### `POST /admin/api/render-markdown`
Preview rendered HTML without writing files.
```json
{ "content": "---\ntitle: Test\n---\n\n# Body", "trusted": false }
```
Returns: `{ html, frontmatter, warnings }`

### `POST /admin/api/dev/apply`
Apply content changes (write/delete/frontmatter-patch) to disk.
```json
{
  "dry_run": true,
  "changes": [
    { "op": "write", "path": "content/blog/post.md", "content": "---\ntitle: ...\n---\n" },
    { "op": "frontmatter", "path": "content/page.md", "patch": { "published": true } },
    { "op": "delete", "path": "content/old-page.md" }
  ]
}
```
Returns: `{ dry_run, results: [{ op, path, status, errors }], summary }`

## CLI Content Commands

```sh
# Scaffold a new page (respects existing numeric-prefix folders)
dune content:create /blog/my-post
dune content:create /blog/my-post --title "My Post" --template blog-post --publish
dune content:create /about --flat              # creates about.md instead of about/default.md
dune content:create /blog/post --json          # structured output for agent use

# Discover frontmatter schemas — or use the list_blueprints MCP tool directly, no shell-out needed
dune blueprint:list                            # table of all blueprints + required fields
dune blueprint:list --json                     # machine-readable
dune blueprint:show post                       # full field schema with example frontmatter
dune blueprint:show post --json                # structured for agent consumption

# Update skills after upgrading Dune
dune update:skills                             # reinstall from current package
```

## Common Patterns

### Find all blog posts in a category
```
list_pages({ template: "blog", taxonomy: { category: ["tutorials"] }, published: true })
```

### Get page and check for broken links
```
get_page({ route: "/docs/quickstart" })
→ check html field for <a href="..."> tags
```

### Discover required fields, then write content directly
```
list_blueprints({ template: "blog-post" })
→ read required fields
write_page({ path: "blog/new-post.md", content: "---\ntitle: ...\n---\n\nBody" })
update_frontmatter({ path: "blog/new-post.md", updates: { published: true } })
```
Prefer `write_page`/`update_frontmatter` directly over `dune content:create` + manual editing when you're already in an MCP session — fewer round trips, and no shell-out.

### Check what templates are available before setting frontmatter
```
list_templates()
→ confirm "product" template exists before writing template: product
```

### Read site config to understand taxonomies
```
get_config()
→ site.taxonomies tells you what taxonomy keys are valid
```

## Programmatic Use

Embed the MCP server in a Deno Fresh app — read tools and resources only, not the write/scaffold tools (those are CLI-only, see above):

```typescript
import { McpServer, buildTools, buildResources } from "@dune/core/mcp";

const server = new McpServer({ name: "my-site", version: "1.0" });

for (const { meta, handler } of buildTools({ engine, search })) {
  server.registerTool(meta, handler);
}
for (const { meta, handler } of buildResources(engine, storage, root)) { // positional, not an object — storage/root optional
  server.registerResource(meta, handler);
}

await server.serve(); // blocks until stdin closes
```

## Startup Notes

- **Search**: By default, `mcp:serve` builds the search index on startup. Use `--no-search` to skip (also disables `search_content`).
- **Config**: The server uses a lightweight bootstrap (no auth, no collab, no scheduler) for fast startup.
- **Not read-only**: Write and scaffold tools mutate the filesystem directly via the same `StorageAdapter` the rest of Dune uses — same effect as `POST /admin/api/dev/apply`, but without a running server. In dev mode the file watcher picks up changes automatically.
- **Stderr**: Debug output goes to stderr so it doesn't pollute the JSON-RPC stdout stream.
