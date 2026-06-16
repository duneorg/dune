/**
 * Dune CLI entry point.
 *
 * Commands:
 *   dune new [dir]             — Scaffold a new Dune site
 *   dune dev                   — Start dev server with file watching
 *   dune build                 — Build content index + validate config
 *   dune build --static        — Generate a fully static site (SSG)
 *   dune serve                 — Start production server
 *   dune validate              — Whole-project lint: config, plugins, templates, schemas, content
 *   dune cache:clear           — Clear all caches
 *   dune cache:rebuild         — Rebuild content index from scratch
 *   dune lockfile:check        — Exit non-zero if deno.lock is missing entries needed by current plugins
 *   dune lockfile:sync         — Add missing deno.lock entries additively (--upgrade <specifier> to bump a pin)
 *   dune config:show           — Display merged config with source annotations
 *   dune config:validate       — Validate all config files
 *   dune content:list          — List all pages with routes
 *   dune content:check         — Validate content (broken links, missing templates)
 *   dune schema:export         — Print JSON Schema for site.yaml to stdout
 *   dune mcp:serve             — Start MCP server over stdio for AI agent integration
 *   dune plugin:list           — List installed plugins
 *   dune plugin:install <src>  — Add a plugin to site.yaml
 *   dune plugin:remove <src>   — Remove a plugin from site.yaml
 *   dune plugin:create [name]  — Scaffold a new plugin
 *   dune plugin:publish [name] — Publish plugin to JSR
 *   dune plugin:search <query> — Search JSR for plugins
 *   dune plugin:update [name]  — Update JSR plugins to latest versions
 *   dune migrate:from-grav <src>       — Import a Grav site
 *   dune migrate:from-wordpress <src>  — Import a WordPress WXR export
 *   dune migrate:from-markdown <src>   — Import a flat markdown folder
 *   dune migrate:from-hugo <src>       — Import a Hugo site
 *   dune deploy:init <target>          — Scaffold deployment config (fly, docker, deno-deploy)
 *   dune content:create <route>        — Scaffold a new content page at the given route
 *   dune blueprint:list                — List all available blueprints (frontmatter schemas)
 *   dune blueprint:show <template>     — Show full field schema for a blueprint
 *   dune blueprint:validate <file>     — Validate a content file's frontmatter against its blueprint
 *   dune upgrade                       — Update @dune/core to the latest version
 *   dune update:skills                 — Reinstall AI agent skill files from current package
 *   dune content:delete <route>        — Delete a content page by route (requires --confirm or --dry-run)
 *   dune backup [--output file.tar.gz] — Back up content, data, uploads, and config
 *   dune restore <archive.tar.gz>      — Restore from a backup archive
 */

/** @module */

import { devCommand } from "./cli/dev.ts";
import { serveCommand } from "./cli/serve.ts";
import { buildCommand } from "./cli/build.ts";
import { newCommand } from "./cli/new.ts";
import { cacheCommands } from "./cli/cache.ts";
import { configCommands } from "./cli/config.ts";
import { contentCommands } from "./cli/content.ts";
import { i18nStatusCommand } from "./cli/i18n.ts";
import { pluginCommands } from "./cli/plugin.ts";
import {
  migrateFromGrav,
  migrateFromWordPress,
  migrateFromMarkdown,
  migrateFromHugo,
} from "./cli/migrate.ts";
import { schemaExportCommand } from "./cli/schema.ts";
import { validateCommand } from "./cli/validate.ts";
import { mcpServeCommand } from "./cli/mcp.ts";
import { deployInitCommand } from "./cli/deploy.ts";
import { contentCreateCommand } from "./cli/content-create.ts";
import { blueprintCommands } from "./cli/blueprint.ts";
import { updateSkillsCommand } from "./cli/update-skills.ts";
import { contentDeleteCommand } from "./cli/content-delete.ts";
import { checkForUpdates } from "./cli/upgrade-check.ts";
import { upgradeCommand } from "./cli/upgrade.ts";
import {
  codegenCommand,
  migrateGenerateCommand,
  migrateRunCommand,
  migrateStatusCommand,
} from "./cli/db.ts";
import { backupCommand, restoreCommand } from "./cli/backup.ts";
import { flexMigrateCommand } from "./cli/flex-migrate.ts";
import { generateCommand, generateList } from "./cli/generate.ts";
import { addCommand } from "./cli/add.ts";
import { jobsListCommand, jobsRunCommand } from "./cli/jobs.ts";
import { authzSignCommand } from "./cli/authz-sign.ts";
import { migrateAuthToDbCommand } from "./cli/migrate-auth-to-db.ts";
import { migrateRolesToTuplesCommand } from "./cli/migrate-roles-to-tuples.ts";
import { lockfileCheckCommand, lockfileSyncCommand } from "./cli/lockfile.ts";

/** Resolve version string and install source from runtime context. */
function resolveVersion(): { version: string; source: string } {
  const url = import.meta.url;
  if (url.startsWith("file://")) {
    try {
      const denoJsonPath = new URL("../deno.json", url).pathname;
      const denoJson = JSON.parse(Deno.readTextFileSync(denoJsonPath));
      const root = new URL("../", url).pathname.replace(/\/$/, "");
      return { version: denoJson.version ?? "unknown", source: `source: ${root}` };
    } catch {
      return { version: "unknown", source: "source (local)" };
    }
  }
  // JSR URL: https://jsr.io/@dune/core/0.6.9/src/cli.ts
  const jsrMatch = url.match(/jsr\.io\/@dune\/core\/([^/]+)\//);
  return { version: jsrMatch?.[1] ?? "unknown", source: "jsr:@dune/core" };
}

const HELP = `
dune — Flat-file CMS for Deno Fresh

Usage:
  dune <command> [options]

Commands:
  new [dir]           Create a new Dune site
  new [dir] --headless  Create a headless Fresh+Dune site (no theme)
  dev                 Start development server with hot-reload
  build               Build content index and validate config
  build --static      Generate a fully static site (SSG)
  serve               Start production server
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

  plugin:list         List installed plugins and their hook subscriptions
  plugin:install      Add a plugin to site.yaml (e.g. "jsr:@scope/name")
  plugin:remove       Remove a plugin from site.yaml
  plugin:create       Scaffold a new plugin project
  plugin:publish      Publish plugin to JSR (runs deno publish in plugin dir)
  plugin:search       Search JSR for Dune plugins
  plugin:update       Update JSR plugins to their latest versions

  migrate:flex [type]           Migrate Flex Object records to current schema version
  migrate:from-grav <src>       Import a Grav site (user/pages/ folder)
  migrate:from-wordpress <src>  Import a WordPress WXR export (.xml)
  migrate:from-markdown <src>   Import a flat folder of markdown files
  migrate:from-hugo <src>       Import a Hugo site (content/ folder)

  deploy:init <target>          Scaffold deployment config (fly, docker, deno-deploy)

  generate --list               List all available generators
  generate:plugin <name>        Scaffold a plugin in plugins/{name}/index.ts
  generate:route <name>         Create a content page at content/{name}.md
  generate:form <name>          Create a blueprint schema at schemas/{name}.yaml
  generate:theme <name>         Scaffold a theme at themes/{name}/
  generate:schema <name>        Create a Flex Object schema at flex-objects/{name}.yaml
  generate:admin-route <name>   Scaffold an admin API route in src/admin/routes/api/{name}.ts

  authz:sign [--dry-run]       Sign existing permission tuple files with DUNE_AUTHZ_HMAC_SECRET
  migrate:auth-to-db           Migrate flat-file users + tuples to DB (idempotent)
  migrate:roles-to-tuples      Ensure polizy tuples exist for all user roles[] (idempotent)

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
  --debug             Enable debug output
  --json              Output machine-parseable JSON (build, content:*, config:*)
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

export async function main() {
  // Suppress Fresh's built-in update nag — Dune owns the upgrade UX and
  // "Fresh X.Y is available" is an internal detail site users shouldn't see.
  Deno.env.set("FRESH_NO_UPDATE_CHECK", "true");

  const args = Deno.args;
  const command = args[0];

  if (!command || command === "--help" || command === "-h") {
    console.log(HELP.trim());
    Deno.exit(0);
  }

  if (command === "--version" || command === "-V") {
    const { version, source } = resolveVersion();
    console.log(`dune ${version} (${source})`);
    Deno.exit(0);
  }

  // Parse common options
  const options: Record<string, string | boolean> = {};
  // --upgrade is repeatable (and/or comma-separated) — kept out of `options`
  // since that record is single-valued.
  const upgradeKeys: string[] = [];
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--upgrade" && args[i + 1]) {
      upgradeKeys.push(...args[++i].split(",").map((s) => s.trim()).filter(Boolean));
    } else if (args[i] === "--port" && args[i + 1]) {
      options.port = args[++i];
    } else if (args[i] === "--root" && args[i + 1]) {
      options.root = args[++i];
    } else if (args[i] === "--debug") {
      options.debug = true;
    } else if (args[i] === "--static") {
      options.static = true;
    } else if (args[i] === "--out" && args[i + 1]) {
      options.outDir = args[++i];
    } else if (args[i] === "--base-url" && args[i + 1]) {
      options.baseUrl = args[++i];
    } else if (args[i] === "--no-incremental") {
      options.noIncremental = true;
    } else if (args[i] === "--concurrency" && args[i + 1]) {
      options.concurrency = args[++i];
    } else if (args[i] === "--hybrid") {
      options.hybrid = true;
    } else if (args[i] === "--include-drafts") {
      options.includeDrafts = true;
    } else if (args[i] === "--verbose") {
      options.verbose = true;
    } else if (args[i] === "--json") {
      options.json = true;
    } else if (args[i] === "--dry-run") {
      options.dryRun = true;
    } else if (args[i] === "--trust-source") {
      options.trustSource = true;
    } else if (args[i] === "--no-search") {
      options.noSearch = true;
    } else if (args[i] === "--app" && args[i + 1]) {
      options.appName = args[++i];
    } else if (args[i] === "--region" && args[i + 1]) {
      options.region = args[++i];
    } else if (args[i] === "--title" && args[i + 1]) {
      options.title = args[++i];
    } else if (args[i] === "--template" && args[i + 1]) {
      options.template = args[++i];
    } else if (args[i] === "--flat") {
      options.flat = true;
    } else if (args[i] === "--publish") {
      options.publish = true;
    } else if (args[i] === "--no-publish") {
      options.noPublish = true;
    } else if (args[i] === "--headless") {
      options.headless = true;
    } else if (args[i] === "--force") {
      options.force = true;
    } else if (args[i] === "--confirm") {
      options.confirm = true;
    } else if (args[i] === "--yes" || args[i] === "-y") {
      options.yes = true;
    } else if (args[i] === "--output" && args[i + 1]) {
      options.output = args[++i];
    } else if (!args[i].startsWith("--")) {
      // Accept multiple positional args (e.g. migrate source path)
      if (!options.positional) {
        options.positional = args[i];
      } else {
        options.positional2 = args[i];
      }
    }
  }

  const root = (options.root as string) || ".";

  // Auto re-exec with --config if the site root has a deno.json and we weren't
  // already started with one. This ensures dynamically-imported theme TSX files
  // can resolve bare specifiers (preact, etc.) from the site's import map.
  // DUNE_CONFIG_APPLIED env var prevents an infinite re-exec loop.
  //
  // When running from local source (file:// URL) we skip the re-exec entirely:
  // dune's own deno.json already provides @std/*, preact, jsxImportSource etc.,
  // so there is nothing to gain and no import map to restore.
  //
  // lockfile:check/lockfile:sync are also excluded: they never render theme
  // TSX, so they don't need the site import map at this level — they manage
  // their own properly-scoped (scratch-lockfile, optionally --frozen)
  // subprocess internally. Re-execing here would instead resolve this
  // process's own module graph against the site's real deno.lock with no
  // --frozen, silently writing to it before the lockfile command's own
  // careful read-of-original logic ever runs.
  if (!Deno.env.get("DUNE_CONFIG_APPLIED") && command !== "new" &&
      command !== "lockfile:check" && command !== "lockfile:sync" &&
      !import.meta.url.startsWith("file://")) {
    const { resolve, join: joinPath } = await import("@std/path");
    const absRoot = resolve(root);
    const siteDenoJson = joinPath(absRoot, "deno.json");
    try {
      await Deno.stat(siteDenoJson);
      // Re-exec using cli.ts (not cli-impl.ts) so the entry-point module is
      // executed as a script and calls main() automatically.
      const cliUrl = new URL("./cli.ts", import.meta.url).href;
      const cmd = new Deno.Command(Deno.execPath(), {
        args: ["run", "-A", `--config=${siteDenoJson}`, cliUrl, ...args],
        env: { ...Deno.env.toObject(), DUNE_CONFIG_APPLIED: "1", DENO_NO_UPDATE_CHECK: "1" },
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      });
      const status = await cmd.spawn().status;
      Deno.exit(status.code);
    } catch {
      // No deno.json in site root — proceed normally
    }
  }

  try {
    switch (command) {
      case "new":
        await newCommand(options.positional as string || "my-site", {
          headless: options.headless === true,
        });
        break;

      case "dev":
        checkForUpdates();
        await devCommand(root, {
          port: parseInt(options.port as string) || 3000,
          debug: options.debug === true,
        });
        break;

      case "validate":
        await validateCommand(root, {
          debug: options.debug === true,
          json: options.json === true,
          skills: options.skills === false ? false : undefined, // undefined = auto-detect
        });
        break;

      case "build":
        await buildCommand(root, {
          debug: options.debug === true,
          static: options.static === true,
          outDir: options.outDir as string | undefined,
          baseUrl: options.baseUrl as string | undefined,
          noIncremental: options.noIncremental === true,
          concurrency: options.concurrency ? parseInt(options.concurrency as string) : undefined,
          hybrid: options.hybrid === true,
          includeDrafts: options.includeDrafts === true,
          verbose: options.verbose === true,
          json: options.json === true,
        });
        break;

      case "serve":
        checkForUpdates();
        await serveCommand(root, {
          port: parseInt(options.port as string) || 3000,
          debug: options.debug === true,
        });
        break;

      case "cache:clear":
        await cacheCommands.clear(root);
        break;

      case "cache:rebuild":
        await cacheCommands.rebuild(root, { debug: options.debug === true });
        break;

      case "lockfile:check":
        await lockfileCheckCommand(root, { json: options.json === true });
        break;

      case "lockfile:sync":
        await lockfileSyncCommand(root, {
          json: options.json === true,
          upgrade: upgradeKeys.length > 0 ? upgradeKeys : undefined,
        });
        break;

      case "config:show":
        await configCommands.show(root, { json: options.json === true });
        break;

      case "config:validate":
        await configCommands.validate(root, { json: options.json === true });
        break;

      case "content:list":
        await contentCommands.list(root, { debug: options.debug === true, json: options.json === true });
        break;

      case "content:check":
        await contentCommands.check(root, { debug: options.debug === true, json: options.json === true });
        break;

      case "content:i18n-status":
        await i18nStatusCommand(root, { debug: options.debug === true });
        break;

      case "content:create":
        await contentCreateCommand(root, options.positional as string, {
          debug: options.debug === true,
          title: options.title as string | undefined,
          template: options.template as string | undefined,
          flat: options.flat === true,
          publish: options.publish === true,
          json: options.json === true,
        });
        break;

      case "schema:export":
        await schemaExportCommand();
        break;

      case "codegen":
        await codegenCommand(root);
        break;

      case "migrate:generate":
        await migrateGenerateCommand(root);
        break;

      case "migrate:run":
        await migrateRunCommand(root);
        break;

      case "migrate:status":
        await migrateStatusCommand(root);
        break;

      case "migrate:flex":
        await flexMigrateCommand(root, {
          type: options.positional as string | undefined,
          dryRun: options.dryRun === true,
        });
        break;

      case "mcp:serve":
        await mcpServeCommand(root, {
          debug: options.debug === true,
          search: options.noSearch !== true,
        });
        break;

      case "plugin:list":
        await pluginCommands.list(root);
        break;

      case "plugin:install":
        await pluginCommands.install(root, options.positional as string);
        break;

      case "plugin:remove":
        await pluginCommands.remove(root, options.positional as string);
        break;

      case "plugin:create":
        await pluginCommands.create(root, options.positional as string);
        break;

      case "plugin:publish":
        await pluginCommands.publish(root, options.positional as string);
        break;

      case "plugin:search":
        await pluginCommands.search(root, options.positional as string);
        break;

      case "plugin:update":
        await pluginCommands.update(root, options.positional as string);
        break;

      case "migrate:from-grav":
        await migrateFromGrav(options.positional as string, root, {
          out: options.outDir as string | undefined,
          dryRun: options.dryRun === true,
          verbose: options.verbose === true,
          trustSource: options.trustSource === true,
        });
        break;

      case "migrate:from-wordpress":
        await migrateFromWordPress(options.positional as string, root, {
          out: options.outDir as string | undefined,
          dryRun: options.dryRun === true,
          verbose: options.verbose === true,
          trustSource: options.trustSource === true,
        });
        break;

      case "migrate:from-markdown":
        await migrateFromMarkdown(options.positional as string, root, {
          out: options.outDir as string | undefined,
          dryRun: options.dryRun === true,
          verbose: options.verbose === true,
          trustSource: options.trustSource === true,
        });
        break;

      case "migrate:from-hugo":
        await migrateFromHugo(options.positional as string, root, {
          out: options.outDir as string | undefined,
          dryRun: options.dryRun === true,
          verbose: options.verbose === true,
          trustSource: options.trustSource === true,
        });
        break;

      case "authz:sign":
        await authzSignCommand(root, {
          dryRun: options.dryRun === true,
        });
        break;

      case "migrate:auth-to-db":
        await migrateAuthToDbCommand(root, {
          dryRun: options.dryRun === true,
        });
        break;

      case "migrate:roles-to-tuples":
        await migrateRolesToTuplesCommand(root, {
          dryRun: options.dryRun === true,
        });
        break;

      case "jobs:list":
        await jobsListCommand(root, {
          json: options.json === true,
          debug: options.debug === true,
        });
        break;

      case "jobs:run":
        await jobsRunCommand(root, options.positional as string, {
          debug: options.debug === true,
        });
        break;

      case "add":
        await addCommand(root, options.positional as string, {
          force: options.force === true,
        });
        break;

      case "update:skills":
        await updateSkillsCommand(root, {
          debug: options.debug === true,
          force: options.force === true,
        });
        break;

      case "blueprint:list":
        await blueprintCommands.list(root, {
          debug: options.debug === true,
          json: options.json === true,
        });
        break;

      case "blueprint:show":
        await blueprintCommands.show(root, options.positional as string, {
          debug: options.debug === true,
          json: options.json === true,
        });
        break;

      case "blueprint:validate":
        await blueprintCommands.validate(root, options.positional as string, {
          debug: options.debug === true,
          json: options.json === true,
        });
        break;

      case "content:delete":
        await contentDeleteCommand(root, options.positional as string, {
          debug: options.debug === true,
          confirm: options.confirm === true,
          dryRun: options.dryRun === true,
          json: options.json === true,
        });
        break;

      case "upgrade":
        await upgradeCommand(root, { debug: options.debug === true });
        break;

      case "deploy:init":
        await deployInitCommand(root, options.positional as string, {
          debug: options.debug === true,
          port: options.port ? parseInt(options.port as string) : undefined,
          appName: options.appName as string | undefined,
          region: options.region as string | undefined,
          out: options.outDir as string | undefined,
        });
        break;

      case "backup":
        await backupCommand(root, {
          output: options.output as string | undefined,
        });
        break;

      case "restore":
        await restoreCommand(root, options.positional as string, {
          yes: options.yes === true,
        });
        break;

      case "generate":
        generateList();
        break;

      case "generate:plugin":
      case "generate:route":
      case "generate:form":
      case "generate:theme":
      case "generate:schema":
      case "generate:admin-route":
        await generateCommand(root, command, options.positional as string, {
          force: options.force === true,
          permission: options.permission as string | undefined,
        });
        break;

      default:
        console.error(`Unknown command: ${command}`);
        console.log(HELP.trim());
        Deno.exit(1);
    }
  } catch (err) {
    console.error(`\n✗ ${err instanceof Error ? err.message : err}`);
    if (options.debug) {
      console.error(err);
    }
    Deno.exit(1);
  }
}

