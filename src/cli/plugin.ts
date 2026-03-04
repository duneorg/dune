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

  // ── mod.ts ──
  const modTs = `/**
 * ${pluginName} — Dune CMS plugin.
 *
 * Register this plugin in config/site.yaml:
 *
 *   plugins:
 *     - src: "./plugins/${pluginName}/mod.ts"
 */

import type { DunePlugin } from "../../src/hooks/types.ts";

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

    hooks: {
      // Subscribe to lifecycle events here.
      // See src/hooks/types.ts for the full list of HookEvent values.
      //
      // Example: log every page request
      // onRequest: (ctx) => {
      //   console.log("[${pluginName}] request:", ctx.data);
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

## Development

\`\`\`bash
dune dev   # The plugin is hot-reloaded with the site
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
};
