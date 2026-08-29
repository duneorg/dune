/**
 * Dune CLI entry point.
 *
 * Commands:
 *   dune new [dir]             — Scaffold a new Dune site
 *   dune dev                   — Start dev server with file watching
 *   dune dev:link              — Reinstall the global shim against this checkout
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
 *   dune plugin:install <src>  — Add a plugin to site.yaml (--dry-run to preview)
 *   dune plugin:remove <src>   — Remove a plugin from site.yaml (--dry-run to preview)
 *   dune plugin:create [name]  — Scaffold a new plugin
 *   dune plugin:publish [name] — Publish plugin to JSR
 *   dune plugin:search <query> — Search JSR for plugins
 *   dune plugin:update [name]  — Update JSR plugins to latest versions (--dry-run to preview)
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
import { devLinkCommand } from "./cli/dev-link.ts";
import { computeLockPolicy, parseRootArg } from "./cli/lock-policy.ts";
import { loadEnvFile, parseEnvFileArg } from "./cli/env-file.ts";
import { serveCommand } from "./cli/serve.ts";
import { buildCommand } from "./cli/build.ts";
import { newCommand } from "./cli/new.ts";
import { cacheCommands } from "./cli/cache.ts";
import { configCommands } from "./cli/config.ts";
import { contentCommands } from "./cli/content.ts";
import { i18nStatusCommand } from "./cli/i18n.ts";
import { pluginCommands } from "./cli/plugin.ts";
import { themeCommands } from "./cli/theme.ts";
import {
  migrateFromGrav,
  migrateFromHugo,
  migrateFromMarkdown,
  migrateFromWordPress,
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
import { migrateEntrypointCommand } from "./cli/migrate-entrypoint.ts";
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
import { migrateUsersCommand } from "./cli/migrate-users.ts";
import { grantRoleCommand, revokeRoleCommand } from "./cli/users-role.ts";
import { usersCreateCommand } from "./cli/users-create.ts";
import { lockfileCheckCommand, lockfileSyncCommand } from "./cli/lockfile.ts";
import { parseCliOptions } from "./cli/args.ts";
import { maybeReexecWithSiteConfig } from "./cli/reexec.ts";
import { HELP } from "./cli/help.ts";

/** Resolve version string and install source from runtime context. */
function resolveVersion(): { version: string; source: string } {
  const url = import.meta.url;
  if (url.startsWith("file://")) {
    try {
      const denoJsonPath = new URL("../deno.json", url).pathname;
      const denoJson = JSON.parse(Deno.readTextFileSync(denoJsonPath));
      const root = new URL("../", url).pathname.replace(/\/$/, "");
      return {
        version: denoJson.version ?? "unknown",
        source: `source: ${root}`,
      };
    } catch {
      return { version: "unknown", source: "source (local)" };
    }
  }
  // JSR URL: https://jsr.io/@dune/core/0.6.9/src/cli.ts
  const jsrMatch = url.match(/jsr\.io\/@dune\/core\/([^/]+)\//);
  return { version: jsrMatch?.[1] ?? "unknown", source: "jsr:@dune/core" };
}


export async function main(args: string[] = Deno.args) {
  // Suppress Fresh's built-in update nag — Dune owns the upgrade UX and
  // "Fresh X.Y is available" is an internal detail site users shouldn't see.
  Deno.env.set("FRESH_NO_UPDATE_CHECK", "true");

  // Redundant with (and a no-op after) cli.ts's own --env-file loading on the
  // normal `dune` invocation path — kept here too so the `cli()` callable
  // export (generated main.ts entrypoints, which import this module directly
  // and never go through cli.ts's import.meta.main block) also supports it.
  const envFileArg = parseEnvFileArg(args);
  if (envFileArg) {
    try {
      await loadEnvFile(envFileArg, parseRootArg(args));
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      Deno.exit(1);
    }
  }

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

  const { options, upgradeKeys, roleValues } = parseCliOptions(args);

  const root = (options.root as string) || ".";

  await maybeReexecWithSiteConfig(args, command, root);

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

      case "dev:link":
        await devLinkCommand();
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
          concurrency: options.concurrency
            ? parseInt(options.concurrency as string)
            : undefined,
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
          // Effective policy, not the raw flag: frozen is opt-in (--frozen /
          // DUNE_FROZEN=1 — see lock-policy.ts's module doc for why serve
          // doesn't default to it). Deno-level enforcement happens via the
          // re-exec args; this only steers the app-level staleness message
          // in serveCommand.
          frozen: (await computeLockPolicy(args)).mode === "frozen",
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
        await contentCommands.list(root, {
          debug: options.debug === true,
          json: options.json === true,
        });
        break;

      case "content:check":
        await contentCommands.check(root, {
          debug: options.debug === true,
          json: options.json === true,
          render: options.render === true,
        });
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

      case "migrate:entrypoint":
        await migrateEntrypointCommand(root, {
          dryRun: options.dryRun === true,
        });
        break;

      case "mcp:serve":
        await mcpServeCommand(root, {
          debug: options.debug === true,
          search: options.noSearch !== true,
          readonly: options.readonly === true,
        });
        break;

      case "plugin:list":
        await pluginCommands.list(root);
        break;

      case "plugin:install":
        await pluginCommands.install(root, options.positional as string, {
          integrity: options.integrity as string | undefined,
          dryRun: options.dryRun === true,
        });
        break;

      case "plugin:remove":
        await pluginCommands.remove(root, options.positional as string, {
          dryRun: options.dryRun === true,
        });
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
        await pluginCommands.update(root, options.positional as string, {
          dryRun: options.dryRun === true,
        });
        break;

      case "theme:list":
        await themeCommands.list(root);
        break;

      case "theme:install":
        await themeCommands.install(root, options.positional as string, {
          name: options.themeName as string | undefined,
          activate: options.activate === true,
        });
        break;

      case "theme:remove":
        await themeCommands.remove(root, options.positional as string);
        break;

      case "theme:publish":
        await themeCommands.publish(root, options.positional as string);
        break;

      case "migrate:from-grav":
        await migrateFromGrav(options.positional as string, root, {
          out: options.outDir as string | undefined,
          dryRun: options.dryRun === true,
          verbose: options.verbose === true,
          trustSource: options.trustSource === true,
          fireHooks: options.fireHooks === true,
        });
        break;

      case "migrate:from-wordpress":
        await migrateFromWordPress(options.positional as string, root, {
          out: options.outDir as string | undefined,
          dryRun: options.dryRun === true,
          verbose: options.verbose === true,
          trustSource: options.trustSource === true,
          fireHooks: options.fireHooks === true,
        });
        break;

      case "migrate:from-markdown":
        await migrateFromMarkdown(options.positional as string, root, {
          out: options.outDir as string | undefined,
          dryRun: options.dryRun === true,
          verbose: options.verbose === true,
          trustSource: options.trustSource === true,
          fireHooks: options.fireHooks === true,
        });
        break;

      case "migrate:from-hugo":
        await migrateFromHugo(options.positional as string, root, {
          out: options.outDir as string | undefined,
          dryRun: options.dryRun === true,
          verbose: options.verbose === true,
          trustSource: options.trustSource === true,
          fireHooks: options.fireHooks === true,
        });
        break;

      case "authz:sign":
        await authzSignCommand(root, {
          dryRun: options.dryRun === true,
        });
        break;

      case "migrate:users":
        await migrateUsersCommand(root, {
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

      case "users:create":
        await usersCreateCommand(
          root,
          options.positional as string,
          {
            roles: roleValues.length > 0 ? roleValues : undefined,
            name: options.themeName as string | undefined,
            dryRun: options.dryRun === true,
          },
        );
        break;

      case "users:grant-role":
        await grantRoleCommand(
          root,
          options.positional as string,
          options.positional2 as string,
          { dryRun: options.dryRun === true },
        );
        break;

      case "users:revoke-role":
        await revokeRoleCommand(
          root,
          options.positional as string,
          options.positional2 as string,
          { dryRun: options.dryRun === true },
        );
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

/**
 * Callable entry for a site's generated `main.ts` (`import { cli } from
 * "@dune/core/cli"; await cli({ root: import.meta.dirname });`) — no re-exec
 * involved, since the site's own `deno.json`/`deno.lock` already govern this
 * process natively as soon as `main.ts` is the invoked script.
 *
 * `opts.root` is injected as `--root` unless the caller already passed one
 * explicitly on the command line (which wins). Passing `import.meta.dirname`
 * makes root resolution independent of the process's cwd — important since
 * `main.ts` may be invoked by an absolute path from a service manager with no
 * particular working directory set.
 */
export async function cli(opts: { root?: string } = {}): Promise<void> {
  const args = [...Deno.args];
  const hasRoot = args.some((a) => a === "--root" || a.startsWith("--root="));
  if (opts.root && !hasRoot) {
    args.push("--root", opts.root);
  }
  await main(args);
}
