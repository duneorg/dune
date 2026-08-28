/**
 * Top-level `dune --help` text.
 *
 * @module
 */

export const HELP = `
dune — Flat-file CMS for Deno Fresh

Usage:
  dune <command> [options]

Commands:
  new [dir]           Create a new Dune site
  new [dir] --headless  Create a headless Fresh+Dune site (no theme)
  dev                 Start development server with hot-reload
  dev:link            Reinstall the global "dune" shim against this checkout
                      (for developing Dune itself — refreshes its frozen
                      import-map snapshot after deno.json's imports change)
  build               Build content index and validate config
  build --static      Generate a fully static site (SSG)
  serve               Start production server (--frozen enforces deno.lock;
                      opt in with --frozen or DUNE_FROZEN=1 — see CHANGELOG
                      for why this isn't the default yet)
  validate            Whole-project lint: config, plugins, templates, schemas, content, skills

  cache:clear         Clear all caches
  cache:rebuild       Rebuild content index from scratch

  lockfile:check      Exit non-zero if deno.lock is missing entries the current
                      plugins/imports need (read-only, safe pre-restart gate)
  lockfile:sync       Add missing deno.lock entries without touching already-
                      pinned ones; use --upgrade <specifier> to intentionally
                      bump a specific pin

  config:show         Show merged config with source annotations
  config:validate     Validate all config files

  content:list        List all pages with routes and templates
  content:check       Check content for broken links, missing templates
                      (frontmatter-only by default — pass --render to also
                      compile every md/mdx body and catch MDX errors that
                      indexing can't see)
  content:i18n-status Report translation coverage across languages
  content:create      Scaffold a new content page at a given route
  content:delete      Delete a content page by route (requires --confirm or --dry-run)

  blueprint:list      List all blueprints (frontmatter schemas per template)
  blueprint:show      Show full field schema for a template blueprint
  blueprint:validate  Validate a content file's frontmatter against its blueprint

  upgrade             Update @dune/core to the latest version
  update:skills       Reinstall AI coding agent skill files from current package

  schema:export       Print JSON Schema for site.yaml to stdout

  codegen             Generate TypeScript types from schemas/*.yaml
  migrate:generate    Generate SQL migration files from schemas
  migrate:run         Apply pending SQL migrations
  migrate:status      Show applied/pending migration status

  mcp:serve           Start MCP server over stdio (for Claude Code / Cursor / etc.)
                      --readonly omits write/scaffold tools (opt-in; writes stay
                      the default because that is the local-agent workflow)

  plugin:list         List installed plugins and their hook subscriptions
  plugin:install      Add a plugin to site.yaml (e.g. "jsr:@scope/name"; --dry-run to preview)
  plugin:remove       Remove a plugin from site.yaml (--dry-run to preview)
  plugin:create       Scaffold a new plugin project
  plugin:publish      Publish plugin to JSR (runs deno publish in plugin dir)
  plugin:search       Search JSR for Dune plugins
  plugin:update       Update JSR plugins to their latest versions (--dry-run to preview)

  theme:list          List local themes and registered package themes
  theme:install       Register a JSR/npm theme package (--name, --activate)
  theme:remove        Remove a theme from the themes: registry
  theme:publish       Publish a theme package to JSR (deno publish)

  migrate:flex [type]           Migrate Flex Object records to current schema version
  migrate:entrypoint            Move this site onto the generated main.ts entrypoint
                                pattern (writes main.ts, adds missing import map
                                entries, rewrites dev/build/serve tasks). Idempotent;
                                refuses to touch a hand-edited main.ts. --dry-run to
                                preview. Run \`dune validate\` afterward and soak-test
                                before migrating the rest of a fleet.
  migrate:from-grav <src>       Import a Grav site (user/pages/ folder)
  migrate:from-wordpress <src>  Import a WordPress WXR export (.xml)
  migrate:from-markdown <src>   Import a flat folder of markdown files
  migrate:from-hugo <src>       Import a Hugo site (content/ folder)

  deploy:init <target>          Scaffold deployment config (fly, docker, deno-deploy)

  generate --list               List all available generators
  generate:plugin <name>        Scaffold a plugin in plugins/{name}/index.ts
  generate:route <name>         Create a content page at content/{name}.md
  generate:form <name>          Create a form definition at forms/{name}.yaml
  generate:theme <name>         Scaffold a theme at themes/{name}/
  generate:schema <name>        Create a Flex Object schema at flex-objects/{name}.yaml
  generate:admin-route <name>   Scaffold an admin API route in src/admin/routes/api/{name}.ts

  authz:sign [--dry-run]       Sign existing permission tuple files with DUNE_AUTHZ_HMAC_SECRET
  migrate:users                Reshape pre-Phase-5b data/users/ accounts + build email index (idempotent)
  migrate:auth-to-db           Migrate flat-file users + tuples to DB (idempotent)
  migrate:roles-to-tuples      Ensure polizy tuples exist for all user roles[] (idempotent)
  users:create <email>          Create a user record before their first login
                                (--role x[,y], --name "Display Name") — the
                                admin-provisioned account use case; see the
                                command's own doc comment for OAuth vs.
                                magic-link first-login caveats
  users:grant-role <email> <role>   Grant an admin-tier role (admin/editor/author) to a user
  users:revoke-role <email> <role>  Revoke an admin-tier role from a user

  jobs:list                    List all registered jobs with schedule and last-run state
  jobs:run <name>              Trigger a job immediately (dev/ops use)

  add <package>                 Add a package to deno.json imports with scaffolding
                                Examples: dune add polizy
                                          dune add npm:some-lib@^2.0.0
                                          dune add jsr:@scope/pkg

  backup [--output file.tar.gz] Back up content, data, uploads, and config
  restore <archive.tar.gz>      Restore from a backup archive

Options:
  --port <n>          Server port (default: 3000)
  --root <dir>        Site root directory (default: .)
  --env-file[=path]   Load KEY=VALUE pairs from a dotenv file (default: .env)
                      into the environment before startup. Off by default —
                      nothing is auto-loaded without this flag. Values already
                      set in the environment always take precedence.
  --debug             Enable debug output
  --json              Output machine-parseable JSON (build, content:*, config:*)
  --render            (content:check) Compile every md/mdx page body and
                      report pages that fail to render, not just frontmatter
                      issues
  --version, -V       Show version and install source
  --help, -h          Show this help message

Lockfile sync options (used with lockfile:sync):
  --upgrade <specifier>  Allow an already-pinned entry to change (repeatable,
                          or comma-separated). Get the exact key from the
                          "left unchanged" list printed by lockfile:check/sync.

Static build options (used with build --static):
  --out <dir>         Output directory (default: dist)
  --base-url <url>    Canonical base URL for sitemap/feeds
  --no-incremental    Rebuild all pages (ignore change detection)
  --concurrency <n>   Parallel renders (default: 8)
  --hybrid            Emit _routes.json / _redirects / _headers for edge deployments
  --include-drafts    Include unpublished pages
  --verbose           Print each rendered route

Migration options (used with migrate:from-*):
  --out <dir>         Content directory to import into (default: <root>/content)
  --dry-run           Report what would be imported without writing files
  --verbose           Print each imported page
  --trust-source      Skip HTML sanitization — only use for sources you fully trust
  --fire-hooks        Fire onPageCreate for each imported page (off by default —
                      a bulk import running per-page hooks, e.g. webhooks, is
                      more likely a surprise than a feature; opt in deliberately)

Content create options (used with content:create):
  --title <text>      Page title (default: derived from slug)
  --template <name>   Template to use (default: default)
  --flat              Create a flat file (slug.md) instead of slug/default.md
  --publish           Mark the page as published (default: draft)

Content delete options (used with content:delete):
  --confirm           Confirm deletion without interactive prompt
  --dry-run           Preview what would be deleted without actually deleting

Deploy options (used with deploy:init):
  --app <name>        App / service name (default: derived from site title)
  --region <code>     Fly.io primary region code (default: iad)
  --port <n>          Internal port (default: 3000)
  --out <dir>         Output directory for generated files (default: site root)
`;

