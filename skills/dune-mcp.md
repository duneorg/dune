# Skill: dune-mcp — MCP Server Integration

Connects AI coding agents to a live Dune content engine via the Model Context Protocol.

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
  --no-search     Skip building the search index (faster startup)
```

## Available Tools

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

### `get_page`
Get full page data including frontmatter, rendered HTML, and media.

```json
{
  "route": "/blog/hello-world",
  "include_html": true          // include rendered HTML body (default true)
}
```

Returns: `route`, `title`, `date`, `template`, `format`, `published`, `language`, `sourcePath`, `frontmatter`, `html`, `media[]`.

### `search_content`
Full-text search across all pages.

```json
{
  "query": "deno fresh routing",
  "limit": 10,                  // max results (default 10, max 50)
  "template": "blog",           // restrict to template
  "language": "en"              // restrict to language
}
```

Returns: results with `route`, `title`, `score`, `excerpt`.

### `get_taxonomy`
Get taxonomy values with page counts.

```json
{
  "name": "category"  // omit to list all taxonomies
}
```

### `get_config`
Get site configuration summary (no secrets).

Returns: `site` (title, url, taxonomies, feeds), `theme` (name, templates, layouts), `system` (languages, cache), `admin` (path), `plugins` (list of specs).

### `get_runtime_info`
Live snapshot: page counts, formats breakdown, top-level sections, taxonomy summaries, theme info.

### `list_templates`
List all templates and layouts in the active theme.

## Available Resources

| URI | Description |
|-----|-------------|
| `dune://site/config` | Full site.yaml config (secrets omitted) |
| `dune://site/schema` | JSON Schema draft-07 for site.yaml |
| `dune://content/pages` | Complete page index as JSON |
| `dune://content/taxonomy` | All taxonomy values with counts |

## HTTP API — Content Read/Write

These REST endpoints complement the read-only MCP tools.
All require authentication; dev/apply requires `DUNE_ENV=dev` or `system.debug: true`.

### `GET /admin/api/page-source?route=/blog/post`
Read raw source content for a page by its route.
Returns: `{ route, sourcePath, format, content, frontmatter, body, mtime }`

Use before editing: always read current content to avoid clobbering concurrent changes.

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

**Safe editing workflow:**
1. `GET /admin/api/page-source?route=/blog/post` — read current content
2. `POST /admin/api/render-markdown` — preview modified content
3. `POST /admin/api/dev/apply` with `dry_run: true` — validate
4. `POST /admin/api/dev/apply` with `dry_run: false` — write

## CLI Content Commands

```sh
# Scaffold a new page (respects existing numeric-prefix folders)
dune content:create /blog/my-post
dune content:create /blog/my-post --title "My Post" --template blog-post --publish
dune content:create /about --flat              # creates about.md instead of about/default.md
dune content:create /blog/post --json          # structured output for agent use

# Discover frontmatter schemas
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

### Find recently updated pages
```
list_pages({ date_from: "2024-01-01", limit: 10 })
```

### Check what templates are available before setting frontmatter
```
list_templates()
→ confirm "product" template exists before writing template: product
```

### Discover required fields before creating content
```
dune blueprint:show blog-post --json
→ read required fields before content:create or dev/apply
```

### Read site config to understand taxonomies
```
get_config()
→ site.taxonomies tells you what taxonomy keys are valid
```

## Programmatic Use

Embed the MCP server in a Deno Fresh app:

```typescript
import { McpServer, buildTools, buildResources } from "@dune/core/mcp";

const server = new McpServer({ name: "my-site", version: "1.0" });

for (const { meta, handler } of buildTools({ engine, search })) {
  server.registerTool(meta, handler);
}
for (const { meta, handler } of buildResources(engine)) {
  server.registerResource(meta, handler);
}

await server.serve(); // blocks until stdin closes
```

## Startup Notes

- **Search**: By default, `mcp:serve` builds the search index on startup (~1s for 500 pages). Use `--no-search` to skip.
- **Config**: The server uses a lightweight bootstrap (no auth, no collab, no scheduler) for fast startup.
- **Read-only**: All MCP tools are read-only. Content mutations require the admin API.
- **Stderr**: Debug output goes to stderr so it doesn't pollute the JSON-RPC stdout stream.
