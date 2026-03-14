/**
 * Plugin CLI commands.
 *
 *   dune plugin:list                  List installed plugins
 *   dune plugin:install <src>         Add a plugin to site.yaml
 *   dune plugin:remove <src|name>     Remove a plugin from site.yaml
 *   dune plugin:create [name]         Scaffold a new plugin project
 */

import { parse as parseYaml, stringify as stringifyYaml } from "@std/yaml";
import { join } from "@std/path";
import { createStorage } from "../storage/mod.ts";
import { loadConfig } from "../config/mod.ts";
import { loadPlugins, loadPluginAdminConfigs } from "../plugins/loader.ts";
import { createHookRegistry } from "../hooks/registry.ts";

// ─── plugin:list ──────────────────────────────────────────────────────────────

export async function pluginListCommand(root: string): Promise<void> {
  const storage = createStorage({ rootDir: root });
  const config = await loadConfig({ storage, rootDir: root, skipValidation: true });

  const hooks = createHookRegistry({ config, storage });
  const adminCfg = config.admin ?? { dataDir: "data" };
  await loadPluginAdminConfigs(config, storage, adminCfg.dataDir ?? "data");
  await loadPlugins({ config, hooks, storage, root });

  const plugins = hooks.plugins();

  if (plugins.length === 0) {
    console.log("No plugins installed.");
    console.log('Add plugins under the "plugins:" key in config/site.yaml.');
    return;
  }

  console.log(`\nInstalled plugins (${plugins.length}):\n`);
  for (const p of plugins) {
    const desc = p.description ? `  — ${p.description}` : "";
    const author = p.author ? ` by ${p.author}` : "";
    console.log(`  ${p.name}@${p.version}${author}${desc}`);
    const hookNames = Object.keys(p.hooks);
    if (hookNames.length > 0) {
      console.log(`    hooks: ${hookNames.join(", ")}`);
    }
    if (p.configSchema) {
      const fields = Object.keys(p.configSchema);
      console.log(`    config fields: ${fields.join(", ")}`);
    }
  }
  console.log();
}

// ─── plugin:install ───────────────────────────────────────────────────────────

export async function pluginInstallCommand(root: string, src: string): Promise<void> {
  if (!src) {
    console.error("Usage: dune plugin:install <src>");
    console.error('  <src>  Plugin source: "./plugins/my-plugin.ts", "jsr:@scope/name", ...');
    Deno.exit(1);
  }

  const siteYamlPath = join(root, "config", "site.yaml");
  let raw = "";
  try {
    raw = await Deno.readTextFile(siteYamlPath);
  } catch {
    console.error(`Could not read ${siteYamlPath}`);
    Deno.exit(1);
  }

  const parsed = (parseYaml(raw) ?? {}) as Record<string, unknown>;
  const existing = Array.isArray(parsed.plugins) ? parsed.plugins as Array<{ src: string }> : [];

  if (existing.some((e) => e.src === src)) {
    console.log(`Plugin "${src}" is already listed in site.yaml.`);
    return;
  }

  existing.push({ src });
  parsed.plugins = existing;

  await Deno.writeTextFile(siteYamlPath, stringifyYaml(parsed));
  console.log(`✓ Added plugin "${src}" to config/site.yaml`);
  console.log(`  Run "dune dev" to start using the plugin.`);
}

// ─── plugin:remove ────────────────────────────────────────────────────────────

export async function pluginRemoveCommand(root: string, srcOrName: string): Promise<void> {
  if (!srcOrName) {
    console.error("Usage: dune plugin:remove <src|name>");
    Deno.exit(1);
  }

  const siteYamlPath = join(root, "config", "site.yaml");
  let raw = "";
  try {
    raw = await Deno.readTextFile(siteYamlPath);
  } catch {
    console.error(`Could not read ${siteYamlPath}`);
    Deno.exit(1);
  }

  const parsed = (parseYaml(raw) ?? {}) as Record<string, unknown>;
  const existing = Array.isArray(parsed.plugins) ? parsed.plugins as Array<{ src: string }> : [];

  const before = existing.length;
  const filtered = existing.filter(
    (e) => e.src !== srcOrName && !e.src.endsWith(`/${srcOrName}.ts`) && !e.src.includes(srcOrName),
  );

  if (filtered.length === before) {
    console.log(`Plugin "${srcOrName}" not found in site.yaml.`);
    return;
  }

  parsed.plugins = filtered.length > 0 ? filtered : undefined;
  if (!filtered.length) delete parsed.plugins;

  await Deno.writeTextFile(siteYamlPath, stringifyYaml(parsed));
  console.log(`✓ Removed plugin "${srcOrName}" from config/site.yaml`);
}

// ─── plugin:create ────────────────────────────────────────────────────────────

export async function pluginCreateCommand(root: string, name?: string): Promise<void> {
  const pluginName = name ?? "my-plugin";

  // Validate name: lowercase letters, numbers, hyphens only
  if (!/^[a-z0-9-]+$/.test(pluginName)) {
    console.error("Plugin name must contain only lowercase letters, numbers, and hyphens.");
    Deno.exit(1);
  }

  const pluginDir = join(root, "plugins", pluginName);

  // Check if it already exists
  try {
    await Deno.stat(pluginDir);
    console.error(`Directory plugins/${pluginName}/ already exists.`);
    Deno.exit(1);
  } catch { /* does not exist — good */ }

  await Deno.mkdir(pluginDir, { recursive: true });
  await Deno.mkdir(join(pluginDir, "assets"), { recursive: true });
  await Deno.mkdir(join(pluginDir, "templates"), { recursive: true });
  await Deno.mkdir(join(pluginDir, "islands"), { recursive: true });

  // ── mod.ts ──
  const modTs = `/**
 * ${pluginName} — Dune CMS plugin.
 *
 * Register this plugin in config/site.yaml:
 *
 *   plugins:
 *     - src: "./plugins/${pluginName}/mod.ts"
 */

import type { DunePlugin } from "jsr:@dune-cms/core/hooks";

export interface ${toPascalCase(pluginName)}Config {
  // Define your plugin's configuration fields here.
  // example: greeting?: string;
}

/**
 * Create the plugin, receiving its merged config.
 *
 * Use the factory form (function) when you need access to config.
 * For config-free plugins, you may also export a plain DunePlugin object.
 */
export default function create${toPascalCase(pluginName)}(
  _config: ${toPascalCase(pluginName)}Config = {},
): DunePlugin {
  return {
    name: "${pluginName}",
    version: "0.1.0",
    description: "A Dune CMS plugin",

    // Optional: declare plugins this plugin depends on.
    // dependencies: ["other-plugin-name"],

    hooks: {
      // Subscribe to lifecycle events here.
      // See src/hooks/types.ts for the full list of HookEvent values.
      //
      // Example: log every rebuild
      // onRebuild: (ctx) => {
      //   console.log("[${pluginName}] site rebuilt:", ctx.data.pageCount, "pages");
      // },
    },
  };
}
`;

  // ── deno.json ──
  const denoJson = {
    name: `@scope/${pluginName}`,
    version: "0.1.0",
    exports: "./mod.ts",
  };

  // ── README.md ──
  const readme = `# ${pluginName}

A [Dune CMS](https://github.com/your-org/dune) plugin.

## Installation

Add to \`config/site.yaml\`:

\`\`\`yaml
plugins:
  - src: "./plugins/${pluginName}/mod.ts"
\`\`\`

## Configuration

\`\`\`yaml
plugins:
  - src: "./plugins/${pluginName}/mod.ts"
    config:
      # Add your config fields here
\`\`\`

## Directory structure

\`\`\`
plugins/${pluginName}/
  mod.ts          # Plugin entry point
  assets/         # Static files served at /plugins/${pluginName}/...
  templates/      # TSX templates (fallback after active theme chain)
  islands/        # Fresh islands for interactive UI components
  deno.json       # Package metadata (for JSR publishing)
\`\`\`

## Development

\`\`\`bash
dune dev   # The plugin is hot-reloaded with the site
\`\`\`

## Publishing to JSR

\`\`\`bash
dune plugin:publish ${pluginName}
\`\`\`
`;

  await Deno.writeTextFile(join(pluginDir, "mod.ts"), modTs);
  await Deno.writeTextFile(join(pluginDir, "deno.json"), JSON.stringify(denoJson, null, 2) + "\n");
  await Deno.writeTextFile(join(pluginDir, "README.md"), readme);

  console.log(`✓ Scaffolded plugin at plugins/${pluginName}/`);
  console.log(`\nNext steps:`);
  console.log(`  1. Edit plugins/${pluginName}/mod.ts to add your hooks`);
  console.log(`  2. Add to config/site.yaml:`);
  console.log(`       plugins:`);
  console.log(`         - src: "./plugins/${pluginName}/mod.ts"`);
  console.log(`  3. Run "dune dev" to test`);
  console.log(`\nOptional:`);
  console.log(`  • Put static files in assets/  — served at /plugins/${pluginName}/`);
  console.log(`  • Put TSX templates in templates/ — fallback after theme chain`);
  console.log(`  • Put Fresh islands in islands/  — for interactive UI components`);
}

// ─── plugin:publish ───────────────────────────────────────────────────────────

export async function pluginPublishCommand(root: string, name?: string): Promise<void> {
  let pluginDir: string;

  if (name) {
    pluginDir = join(root, "plugins", name);
  } else {
    // Look for a single plugin in plugins/
    const dirs: string[] = [];
    try {
      const entries = await Deno.readDir(join(root, "plugins"));
      for await (const e of entries) {
        if (e.isDirectory) dirs.push(e.name);
      }
    } catch {
      console.error('No plugins/ directory found. Run "dune plugin:create <name>" first.');
      Deno.exit(1);
    }
    if (dirs.length === 0) {
      console.error("No plugins found in plugins/.");
      Deno.exit(1);
    }
    if (dirs.length > 1) {
      console.error(`Multiple plugins found: ${dirs.join(", ")}`);
      console.error("Specify which to publish: dune plugin:publish <name>");
      Deno.exit(1);
    }
    name = dirs[0];
    pluginDir = join(root, "plugins", name);
  }

  // Verify deno.json exists
  try {
    await Deno.stat(join(pluginDir, "deno.json"));
  } catch {
    console.error(
      `No deno.json found in plugins/${name}/. Make sure the plugin was scaffolded with "dune plugin:create".`,
    );
    Deno.exit(1);
  }

  console.log(`Publishing plugin "${name}" to JSR...`);
  console.log(`  Working directory: plugins/${name}/\n`);

  const cmd = new Deno.Command("deno", {
    args: ["publish"],
    cwd: pluginDir,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  const { code, success } = await cmd.output();
  if (!success) {
    console.error(`\n✗ Publish failed (exit code ${code}).`);
    Deno.exit(code ?? 1);
  }

  console.log(`\n✓ Plugin "${name}" published to JSR.`);
}

// ─── plugin:search ────────────────────────────────────────────────────────────

export async function pluginSearchCommand(_root: string, query: string): Promise<void> {
  if (!query) {
    console.error("Usage: dune plugin:search <query>");
    Deno.exit(1);
  }

  const url = `https://jsr.io/api/packages?query=${encodeURIComponent(query)}&limit=20`;

  interface JsrPackage {
    name: string;
    scope: string;
    description?: string;
    latestVersion?: string;
  }

  let result: { items?: JsrPackage[] };
  try {
    const res = await fetch(url, { headers: { "Accept": "application/json" } });
    if (!res.ok) throw new Error(`JSR API returned ${res.status}`);
    result = await res.json() as { items?: JsrPackage[] };
  } catch (err) {
    console.error(`Failed to search JSR: ${err instanceof Error ? err.message : err}`);
    Deno.exit(1);
  }

  const items = result!.items ?? [];
  if (items.length === 0) {
    console.log(`No JSR packages found for "${query}".`);
    return;
  }

  console.log(`\nJSR packages matching "${query}" (${items.length} results):\n`);
  for (const pkg of items) {
    const id = `@${pkg.scope}/${pkg.name}`;
    const ver = pkg.latestVersion ? `@${pkg.latestVersion}` : "";
    const desc = pkg.description ? `  — ${pkg.description}` : "";
    console.log(`  ${id}${ver}${desc}`);
    console.log(`    Install: dune plugin:install "jsr:${id}"`);
  }
  console.log();
}

// ─── plugin:update ────────────────────────────────────────────────────────────

export async function pluginUpdateCommand(root: string, name?: string): Promise<void> {
  const siteYamlPath = join(root, "config", "site.yaml");
  let raw = "";
  try {
    raw = await Deno.readTextFile(siteYamlPath);
  } catch {
    console.error(`Could not read ${siteYamlPath}`);
    Deno.exit(1);
  }

  const parsed = (parseYaml(raw) ?? {}) as Record<string, unknown>;
  const plugins = Array.isArray(parsed.plugins) ? parsed.plugins as Array<{ src: string }> : [];

  // Filter to JSR plugins (and optionally by name)
  const jsrPlugins = plugins.filter((p) => {
    if (!p.src.startsWith("jsr:")) return false;
    if (name) return p.src.includes(name);
    return true;
  });

  if (jsrPlugins.length === 0) {
    console.log(
      name
        ? `No JSR plugin matching "${name}" found in site.yaml.`
        : "No JSR plugins found in site.yaml. Only JSR plugins can be checked for updates.",
    );
    return;
  }

  let updated = 0;
  console.log();

  for (const entry of jsrPlugins) {
    // Parse "jsr:@scope/name@version" or "jsr:@scope/name"
    const match = entry.src.match(/^jsr:(@[^@]+)(?:@(.+))?$/);
    if (!match) {
      console.log(`  Skipping ${entry.src} (unrecognised specifier format)`);
      continue;
    }

    const [, pkgId, currentVersion] = match;
    const scopeMatch = pkgId.match(/^@([^/]+)\/(.+)$/);
    if (!scopeMatch) continue;
    const [, scope, pkgName] = scopeMatch;

    try {
      const res = await fetch(`https://jsr.io/api/scopes/${scope}/packages/${pkgName}`, {
        headers: { "Accept": "application/json" },
      });
      if (!res.ok) {
        console.log(`  ${pkgId}: could not check (JSR returned ${res.status})`);
        continue;
      }
      const data = await res.json() as { latestVersion?: string };
      const latest = data.latestVersion;

      if (!latest) {
        console.log(`  ${pkgId}: no latest version on JSR`);
        continue;
      }

      if (currentVersion === latest) {
        console.log(`  ${pkgId}@${latest} — up to date`);
        continue;
      }

      entry.src = `jsr:${pkgId}@${latest}`;
      console.log(`  ${pkgId}: ${currentVersion ?? "(unpinned)"} → ${latest}`);
      updated++;
    } catch (err) {
      console.log(`  ${pkgId}: error — ${err instanceof Error ? err.message : err}`);
    }
  }

  if (updated > 0) {
    await Deno.writeTextFile(siteYamlPath, stringifyYaml(parsed));
    console.log(`\n✓ Updated ${updated} plugin${updated !== 1 ? "s" : ""} in config/site.yaml.`);
    console.log(`  Run "dune dev" to apply updates.`);
  } else {
    console.log("\nAll JSR plugins are up to date.");
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function toPascalCase(str: string): string {
  return str
    .split("-")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("");
}

export const pluginCommands = {
  list: pluginListCommand,
  install: pluginInstallCommand,
  remove: pluginRemoveCommand,
  create: pluginCreateCommand,
  publish: pluginPublishCommand,
  search: pluginSearchCommand,
  update: pluginUpdateCommand,
};
