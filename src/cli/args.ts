/**
 * Shared CLI option parser.
 *
 * Parses the flags accepted by every top-level `dune` command into a single
 * options record plus the repeatable `--upgrade` / `--role` lists.
 *
 * @module
 */

export interface ParsedCliArgs {
  command: string;
  options: Record<string, string | boolean>;
  upgradeKeys: string[];
  roleValues: string[];
}

/** Parse argv (without the program name) into command + options. */
export function parseCliOptions(args: string[]): ParsedCliArgs {
  const command = args[0];

  // Parse common options
  const options: Record<string, string | boolean> = {};
  // --upgrade and --role are repeatable (and/or comma-separated) — kept out
  // of `options` since that record is single-valued.
  const upgradeKeys: string[] = [];
  const roleValues: string[] = [];
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--role" && args[i + 1]) {
      roleValues.push(
        ...args[++i].split(",").map((s) => s.trim()).filter(Boolean),
      );
    } else if (args[i] === "--upgrade" && args[i + 1]) {
      upgradeKeys.push(
        ...args[++i].split(",").map((s) => s.trim()).filter(Boolean),
      );
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
    } else if (args[i] === "--render") {
      options.render = true;
    } else if (args[i] === "--dry-run") {
      options.dryRun = true;
    } else if (args[i] === "--trust-source") {
      options.trustSource = true;
    } else if (args[i] === "--fire-hooks") {
      options.fireHooks = true;
    } else if (args[i] === "--no-search") {
      options.noSearch = true;
    } else if (args[i] === "--frozen" || args[i] === "--no-frozen") {
      // Consumed by computeLockPolicy (which also reads DUNE_FROZEN and
      // applies the per-command defaults) — matched here so the flags don't
      // fall through the parser, but not stored in `options`.
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
    } else if (args[i] === "--activate") {
      options.activate = true;
    } else if (args[i] === "--name" && args[i + 1]) {
      options.themeName = args[++i];
    } else if (args[i] === "--integrity" && args[i + 1]) {
      options.integrity = args[++i];
    } else if (args[i] === "--readonly") {
      options.readonly = true;
    } else if (!args[i].startsWith("--")) {
      // Accept multiple positional args (e.g. migrate source path)
      if (!options.positional) {
        options.positional = args[i];
      } else {
        options.positional2 = args[i];
      }
    }
  }

  return { command, options, upgradeKeys, roleValues };
}
