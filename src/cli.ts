/**
 * Dune CLI entry point.
 *
 * Commands:
 *   dune new [dir]             — Scaffold a new Dune site
 *   dune dev                   — Start dev server with file watching
 *   dune build                 — Build content index + validate config
 *   dune build --static        — Generate a fully static site (SSG)
 *   dune serve                 — Start production server
 *   dune cache:clear           — Clear all caches
 *   dune cache:rebuild         — Rebuild content index from scratch
 *   dune config:show           — Display merged config with source annotations
 *   dune config:validate       — Validate all config files
 *   dune content:list          — List all pages with routes
 *   dune content:check         — Validate content (broken links, missing templates)
 *   dune plugin:list           — List installed plugins
 *   dune plugin:install <src>  — Add a plugin to site.yaml
 *   dune plugin:remove <src>   — Remove a plugin from site.yaml
 *   dune plugin:create [name]  — Scaffold a new plugin
 *   dune plugin:publish [name] — Publish plugin to JSR
 *   dune plugin:search <query> — Search JSR for plugins
 *   dune plugin:update [name]  — Update JSR plugins to latest versions
 */

import { devCommand } from "./cli/dev.ts";
import { serveCommand } from "./cli/serve.ts";
import { buildCommand } from "./cli/build.ts";
import { newCommand } from "./cli/new.ts";
import { cacheCommands } from "./cli/cache.ts";
import { configCommands } from "./cli/config.ts";
import { contentCommands } from "./cli/content.ts";
import { i18nStatusCommand } from "./cli/i18n.ts";
import { pluginCommands } from "./cli/plugin.ts";

const HELP = `
dune — Flat-file CMS for Deno Fresh

Usage:
  dune <command> [options]

Commands:
  new [dir]           Create a new Dune site
  dev                 Start development server with hot-reload
  build               Build content index and validate config
  build --static      Generate a fully static site (SSG)
  serve               Start production server

  cache:clear         Clear all caches
  cache:rebuild       Rebuild content index from scratch

  config:show         Show merged config with source annotations
  config:validate     Validate all config files

  content:list        List all pages with routes and templates
  content:check       Check content for broken links, missing templates
  content:i18n-status Report translation coverage across languages

  plugin:list         List installed plugins and their hook subscriptions
  plugin:install      Add a plugin to site.yaml (e.g. "jsr:@scope/name")
  plugin:remove       Remove a plugin from site.yaml
  plugin:create       Scaffold a new plugin project
  plugin:publish      Publish plugin to JSR (runs deno publish in plugin dir)
  plugin:search       Search JSR for Dune plugins
  plugin:update       Update JSR plugins to their latest versions

Options:
  --port <n>          Server port (default: 3000)
  --root <dir>        Site root directory (default: .)
  --debug             Enable debug output
  --help, -h          Show this help message

Static build options (used with build --static):
  --out <dir>         Output directory (default: dist)
  --base-url <url>    Canonical base URL for sitemap/feeds
  --no-incremental    Rebuild all pages (ignore change detection)
  --concurrency <n>   Parallel renders (default: 8)
  --hybrid            Emit _routes.json / _redirects / _headers for edge deployments
  --include-drafts    Include unpublished pages
  --verbose           Print each rendered route
`;

async function main() {
  const args = Deno.args;
  const command = args[0];

  if (!command || command === "--help" || command === "-h") {
    console.log(HELP.trim());
    Deno.exit(0);
  }

  // Parse common options
  const options: Record<string, string | boolean> = {};
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--port" && args[i + 1]) {
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
    } else if (!args[i].startsWith("--")) {
      options.positional = args[i];
    }
  }

  const root = (options.root as string) || ".";

  try {
    switch (command) {
      case "new":
        await newCommand(options.positional as string || "my-site");
        break;

      case "dev":
        await devCommand(root, {
          port: parseInt(options.port as string) || 3000,
          debug: options.debug === true,
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
        });
        break;

      case "serve":
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

      case "config:show":
        await configCommands.show(root);
        break;

      case "config:validate":
        await configCommands.validate(root);
        break;

      case "content:list":
        await contentCommands.list(root, { debug: options.debug === true });
        break;

      case "content:check":
        await contentCommands.check(root, { debug: options.debug === true });
        break;

      case "content:i18n-status":
        await i18nStatusCommand(root, { debug: options.debug === true });
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

main();
