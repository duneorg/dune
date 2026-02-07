/**
 * Dune CLI entry point.
 *
 * Commands:
 *   dune new [dir]         — Scaffold a new Dune site
 *   dune dev               — Start dev server with file watching
 *   dune build             — Build content index + validate config
 *   dune serve             — Start production server
 *   dune cache:clear       — Clear all caches
 *   dune cache:rebuild     — Rebuild content index from scratch
 *   dune config:show       — Display merged config with source annotations
 *   dune config:validate   — Validate all config files
 *   dune content:list      — List all pages with routes
 *   dune content:check     — Validate content (broken links, missing templates)
 *   dune theme:create [n]  — Scaffold a new theme
 */

import { devCommand } from "./cli/dev.ts";
import { serveCommand } from "./cli/serve.ts";
import { buildCommand } from "./cli/build.ts";
import { newCommand } from "./cli/new.ts";
import { cacheCommands } from "./cli/cache.ts";
import { configCommands } from "./cli/config.ts";
import { contentCommands } from "./cli/content.ts";

const HELP = `
dune — Flat-file CMS for Deno Fresh

Usage:
  dune <command> [options]

Commands:
  new [dir]           Create a new Dune site
  dev                 Start development server with hot-reload
  build               Build content index and validate config
  serve               Start production server

  cache:clear         Clear all caches
  cache:rebuild       Rebuild content index from scratch

  config:show         Show merged config with source annotations
  config:validate     Validate all config files

  content:list        List all pages with routes and templates
  content:check       Check content for broken links, missing templates

Options:
  --port <n>          Server port (default: 3000)
  --root <dir>        Site root directory (default: .)
  --debug             Enable debug output
  --help, -h          Show this help message
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
        await buildCommand(root, { debug: options.debug === true });
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
