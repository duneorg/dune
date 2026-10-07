/**
 * Plugin CLI commands.
 *
 *   dune plugin:list                  List installed plugins
 *   dune plugin:install <src>         Add a plugin to site.yaml
 *   dune plugin:remove <src|name>     Remove a plugin from site.yaml
 *   dune plugin:create [name]         Scaffold a new plugin project
 *   dune plugin:update [name]         Bump JSR plugins to their latest versions
 *
 * `plugin:install`, `plugin:remove`, and `plugin:update` accept `--dry-run` to
 * report what would change in config/site.yaml without writing the file.
 *
 * All three mutating commands edit site.yaml text in place (never parse →
 * stringify), so comments, blank lines and quote style survive. Each edit is
 * re-parsed and compared to the intended document before writing; layouts the
 * line-based edit can't handle make the command exit without writing.
 */

import { parse as parseYaml } from "@std/yaml";
import { join } from "@std/path";
import { createStorage } from "../storage/mod.ts";
import { loadConfig } from "../config/mod.ts";
import { loadPluginAdminConfigs, loadPlugins } from "../plugins/loader.ts";
import { createHookRegistry } from "../hooks/registry.ts";
import {
  assertHttpsPluginIntegrity,
  assertPinnedPluginSpecifier,
} from "../plugins/reference.ts";
import type { PluginEntry } from "../config/types.ts";

// ─── plugin:list ──────────────────────────────────────────────────────────────

export async function pluginListCommand(root: string): Promise<void> {
  const storage = createStorage({ rootDir: root });
  const config = await loadConfig({
    storage,
    rootDir: root,
    skipValidation: true,
  });

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

// ─── in-place site.yaml editing ───────────────────────────────────────────────

interface PluginsBlock {
  /** Index of the `plugins:` key line. */
  keyLine: number;
  /** Indent used by the existing list items (default two spaces). */
  itemIndent: string;
  /** Quote character used by the first `src:` value, if any. */
  quote: string;
  /** One entry per list item: first line, end (exclusive) of its content. */
  items: { start: number; end: number }[];
}

const isBlank = (l: string) => l.trim() === "";
const isComment = (l: string) => l.trimStart().startsWith("#");

/** Locate the top-level `plugins:` block-sequence in site.yaml lines. */
function findPluginsBlock(lines: string[]): PluginsBlock | null {
  const keyLine = lines.findIndex((l) =>
    /^plugins:[ \t]*(\[\s*\][ \t]*)?(#.*)?\r?$/.test(l)
  );
  if (keyLine === -1) return null;

  // Block ends at the next top-level key (indent 0, not a `- ` item).
  let blockEnd = lines.length;
  for (let i = keyLine + 1; i < lines.length; i++) {
    const l = lines[i];
    if (isBlank(l) || isComment(l)) continue;
    if (!/^\s/.test(l) && !l.startsWith("- ")) {
      blockEnd = i;
      break;
    }
  }

  const items: { start: number; end: number }[] = [];
  let itemIndent = "  ";
  let quote = '"';
  for (let i = keyLine + 1; i < blockEnd; i++) {
    const m = lines[i].match(/^(\s*)- /);
    if (!m) continue;
    if (items.length === 0) {
      itemIndent = m[1];
      const q = lines[i].match(/\bsrc:[ \t]*(["'])/);
      if (q) quote = q[1];
    } else if (m[1] !== itemIndent) continue;
    items.push({ start: i, end: i });
  }
  for (let n = 0; n < items.length; n++) {
    const limit = n + 1 < items.length ? items[n + 1].start : blockEnd;
    let end = limit;
    while (
      end > items[n].start + 1 &&
      (isBlank(lines[end - 1]) || isComment(lines[end - 1]))
    ) {
      end--;
    }
    items[n].end = end;
  }
  return { keyLine, itemIndent, quote, items };
}

/** Order-insensitive structural comparison of two parsed YAML values. */
function canonical(v: unknown): string {
  return JSON.stringify(
    v,
    (_k, val) =>
      val && typeof val === "object" && !Array.isArray(val)
        ? Object.fromEntries(
          Object.entries(val as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0
          ),
        )
        : val,
  );
}

function failInPlaceEdit(): never {
  console.error(
    "\nCould not edit config/site.yaml in place (unsupported formatting). " +
      "No files written; edit the plugins list manually.",
  );
  Deno.exit(1);
}

/** Exit without writing when an in-place edit doesn't yield the intended document. */
function assertEditMatches(edited: string, expected: unknown): void {
  let ok = false;
  try {
    ok = canonical(parseYaml(edited) ?? {}) === canonical(expected);
  } catch { /* fall through */ }
  if (!ok) failInPlaceEdit();
}

/** Append a plugin entry to site.yaml text, leaving everything else as is. */
export function insertPluginEntry(
  raw: string,
  entry: PluginEntry,
): string {
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  const lines = raw.split(eol);
  const block = findPluginsBlock(lines);

  const indent = block?.itemIndent ?? "  ";
  const q = block?.quote ?? '"';
  const quoted = (v: string) =>
    q === '"' ? JSON.stringify(v) : `'${v.replaceAll("'", "''")}'`;
  const newLines = [`${indent}- src: ${quoted(entry.src)}`];
  if (entry.integrity) {
    newLines.push(`${indent}  integrity: ${quoted(entry.integrity)}`);
  }

  if (!block) {
    // No plugins key: append one at the end of the file.
    const body = raw.endsWith("\n") || raw === "" ? raw : raw + eol;
    return body + `plugins:${eol}` + newLines.join(eol) + eol;
  }
  if (/^plugins:[ \t]*\[\s*\]/.test(lines[block.keyLine])) {
    lines[block.keyLine] = "plugins:";
  }
  const at = block.items.length > 0
    ? block.items[block.items.length - 1].end
    : block.keyLine + 1;
  lines.splice(at, 0, ...newLines);
  return lines.join(eol);
}

/**
 * Remove the plugin list items at `indexes` (positions in the parsed
 * `plugins` array) from site.yaml text, along with the comment lines directly
 * above each. Returns null when the block's items can't be mapped one-to-one
 * onto the parsed entries.
 */
export function removePluginEntries(
  raw: string,
  indexes: Set<number>,
  total: number,
): string | null {
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  const lines = raw.split(eol);
  const block = findPluginsBlock(lines);
  if (!block || block.items.length !== total) return null;

  const drop = new Set<number>();
  block.items.forEach((item, n) => {
    if (!indexes.has(n)) return;
    let start = item.start;
    const floor = n > 0 ? block.items[n - 1].end : block.keyLine + 1;
    while (start > floor && isComment(lines[start - 1])) start--;
    for (let i = start; i < item.end; i++) drop.add(i);
  });
  if (indexes.size === total) drop.add(block.keyLine);

  const kept: string[] = [];
  lines.forEach((l, i) => {
    if (drop.has(i)) return;
    // Don't leave two blank lines where an item used to sit between them.
    if (
      isBlank(l) && kept.length > 0 && isBlank(kept[kept.length - 1]) &&
      drop.has(i - 1)
    ) {
      return;
    }
    kept.push(l);
  });
  return kept.join(eol);
}

// ─── plugin:install ───────────────────────────────────────────────────────────

export async function pluginInstallCommand(
  root: string,
  src: string,
  options: { integrity?: string; dryRun?: boolean } = {},
): Promise<void> {
  const dryRun = options.dryRun === true;
  if (!src) {
    console.error(
      "Usage: dune plugin:install <src> [--integrity sha256:<hex>]",
    );
    console.error(
      '  <src>  Plugin source: "./plugins/my-plugin.ts", "jsr:@scope/name@1.0.0", ...',
    );
    Deno.exit(1);
  }

  try {
    assertPinnedPluginSpecifier(src);
    assertHttpsPluginIntegrity(src, options.integrity);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
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
  const existing = Array.isArray(parsed.plugins)
    ? parsed.plugins as PluginEntry[]
    : [];

  if (existing.some((e) => e.src === src)) {
    console.log(`Plugin "${src}" is already listed in site.yaml.`);
    return;
  }

  const entry: PluginEntry = options.integrity
    ? { src, integrity: options.integrity }
    : { src };
  existing.push(entry);
  parsed.plugins = existing;

  if (dryRun) {
    console.log(`Would add plugin "${src}" to config/site.yaml (dry run).`);
    console.log("  No files written.");
    return;
  }

  const edited = insertPluginEntry(raw, entry);
  assertEditMatches(edited, parsed);
  await Deno.writeTextFile(siteYamlPath, edited);
  console.log(`✓ Added plugin "${src}" to config/site.yaml`);
  console.log(`  Run "dune dev" to start using the plugin.`);

  await printPluginPostInstallHints(root, src);
}

/**
 * Print plugin-specific setup guidance after install for first-party plugins
 * that need a directory, config block, or environment variables to be useful.
 *
 * Matches on the package name within `src` so it works for any specifier form
 * (`jsr:@dune/plugin-pdf`, `jsr:@dune/plugin-pdf@^1.0.0`, etc.).
 */
async function printPluginPostInstallHints(
  root: string,
  src: string,
): Promise<void> {
  if (src.includes("@dune/plugin-pdf")) {
    const pdfDir = join(root, "static", "pdfs");
    const exists = await Deno.stat(pdfDir).then(() => true).catch(() => false);
    if (!exists) {
      await Deno.mkdir(pdfDir, { recursive: true });
      console.log(`\n  📄 @dune/plugin-pdf`);
      console.log(`  ✅ Created static/pdfs/ — drop PDF files here`);
    } else {
      console.log(`\n  📄 @dune/plugin-pdf`);
      console.log(`  ℹ️  static/pdfs/ already exists — drop PDF files here`);
    }
    console.log(`\n  Configure in config/site.yaml (defaults shown):`);
    console.log(`    plugins:`);
    console.log(`      - src: "${src}"`);
    console.log(`        config:`);
    console.log(`          dir: "static/pdfs"   # where your PDFs live`);
    console.log(`          route: "/pdf"        # URL prefix for the viewer`);
    console.log(
      `          index: true          # index extracted text into search`,
    );
    console.log(
      `\n  PDFs are served + indexed automatically; their text shows up in site search.`,
    );
    return;
  }

  if (src.includes("@dune/plugin-meilisearch")) {
    console.log(`\n  🔎 @dune/plugin-meilisearch`);
    console.log(`  This replaces the built-in search engine with Meilisearch.`);
    console.log(
      `\n  1. Run a Meilisearch server (https://www.meilisearch.com).`,
    );
    console.log(
      `  2. Set environment variables (or use the config keys below):`,
    );
    console.log(`       MEILI_URL=http://localhost:7700`);
    console.log(`       MEILI_API_KEY=<your-master-or-search-key>`);
    console.log(`\n  Configure in config/site.yaml:`);
    console.log(`    plugins:`);
    console.log(`      - src: "${src}"`);
    console.log(`        config:`);
    console.log(
      `          url: "http://localhost:7700"   # falls back to MEILI_URL`,
    );
    console.log(
      `          apiKey: ""                      # falls back to MEILI_API_KEY`,
    );
    console.log(
      `          index: "dune"                   # Meilisearch index name`,
    );
    console.log(
      `\n  The index is (re)built from your content on startup and on rebuild.`,
    );
    return;
  }
}

// ─── plugin:remove ────────────────────────────────────────────────────────────

export async function pluginRemoveCommand(
  root: string,
  srcOrName: string,
  options: { dryRun?: boolean } = {},
): Promise<void> {
  const dryRun = options.dryRun === true;
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
  const existing = Array.isArray(parsed.plugins)
    ? parsed.plugins as PluginEntry[]
    : [];

  const before = existing.length;
  const removeIdx = new Set<number>();
  existing.forEach((e, i) => {
    if (
      e.src === srcOrName || e.src.endsWith(`/${srcOrName}.ts`) ||
      e.src.includes(srcOrName)
    ) removeIdx.add(i);
  });
  const filtered = existing.filter((_, i) => !removeIdx.has(i));

  if (filtered.length === before) {
    console.log(`Plugin "${srcOrName}" not found in site.yaml.`);
    return;
  }

  parsed.plugins = filtered.length > 0 ? filtered : undefined;
  if (!filtered.length) delete parsed.plugins;

  if (dryRun) {
    const removedCount = before - filtered.length;
    console.log(
      `Would remove ${removedCount} plugin${
        removedCount !== 1 ? "s" : ""
      } matching "${srcOrName}" from config/site.yaml (dry run).`,
    );
    console.log("  No files written.");
    return;
  }

  const edited = removePluginEntries(raw, removeIdx, before);
  if (edited === null) failInPlaceEdit();
  assertEditMatches(edited, parsed);
  await Deno.writeTextFile(siteYamlPath, edited);
  console.log(`✓ Removed plugin "${srcOrName}" from config/site.yaml`);
}

// ─── plugin:create ────────────────────────────────────────────────────────────

export async function pluginCreateCommand(
  root: string,
  name?: string,
): Promise<void> {
  const pluginName = name ?? "my-plugin";

  // Validate name: lowercase letters, numbers, hyphens only
  if (!/^[a-z0-9-]+$/.test(pluginName)) {
    console.error(
      "Plugin name must contain only lowercase letters, numbers, and hyphens.",
    );
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

import type { DunePlugin } from "jsr:@dune/core/plugins";

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
  await Deno.writeTextFile(
    join(pluginDir, "deno.json"),
    JSON.stringify(denoJson, null, 2) + "\n",
  );
  await Deno.writeTextFile(join(pluginDir, "README.md"), readme);

  console.log(`✓ Scaffolded plugin at plugins/${pluginName}/`);
  console.log(`\nNext steps:`);
  console.log(`  1. Edit plugins/${pluginName}/mod.ts to add your hooks`);
  console.log(`  2. Add to config/site.yaml:`);
  console.log(`       plugins:`);
  console.log(`         - src: "./plugins/${pluginName}/mod.ts"`);
  console.log(`  3. Run "dune dev" to test`);
  console.log(`\nOptional:`);
  console.log(
    `  • Put static files in assets/  — served at /plugins/${pluginName}/`,
  );
  console.log(
    `  • Put TSX templates in templates/ — fallback after theme chain`,
  );
  console.log(
    `  • Put Fresh islands in islands/  — for interactive UI components`,
  );
}

// ─── plugin:publish ───────────────────────────────────────────────────────────

export async function pluginPublishCommand(
  root: string,
  name?: string,
): Promise<void> {
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
      console.error(
        'No plugins/ directory found. Run "dune plugin:create <name>" first.',
      );
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

export async function pluginSearchCommand(
  _root: string,
  query: string,
): Promise<void> {
  if (!query) {
    console.error("Usage: dune plugin:search <query>");
    Deno.exit(1);
  }

  const url = `https://jsr.io/api/packages?query=${
    encodeURIComponent(query)
  }&limit=20`;

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
    console.error(
      `Failed to search JSR: ${err instanceof Error ? err.message : err}`,
    );
    Deno.exit(1);
  }

  const items = result!.items ?? [];
  if (items.length === 0) {
    console.log(`No JSR packages found for "${query}".`);
    return;
  }

  console.log(
    `\nJSR packages matching "${query}" (${items.length} results):\n`,
  );
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

export interface PluginUpdateOptions {
  /** Compute the changes but do not write config/site.yaml. */
  dryRun?: boolean;
  /**
   * Test seam: resolve the latest published version of a JSR package.
   * Returns `null` when the version cannot be determined. Defaults to a
   * lookup against the public JSR API.
   */
  resolveLatestVersion?: (
    scope: string,
    pkgName: string,
  ) => Promise<string | null>;
}

/** Default JSR latest-version lookup used by `pluginUpdateCommand`. */
async function fetchLatestJsrVersion(
  scope: string,
  pkgName: string,
): Promise<string | null> {
  const res = await fetch(
    `https://jsr.io/api/scopes/${scope}/packages/${pkgName}`,
    { headers: { "Accept": "application/json" } },
  );
  if (!res.ok) {
    throw new Error(`JSR returned ${res.status}`);
  }
  const data = await res.json() as { latestVersion?: string };
  return data.latestVersion ?? null;
}

/**
 * Rewrite `src:` values in raw site.yaml text, touching nothing else.
 *
 * `replacements` maps an existing specifier to its new one. Only the matched
 * text inside the (single/double/un-quoted) value changes, so comments, blank
 * lines and quote style are preserved byte-for-byte. Comment-only lines are
 * skipped.
 */
export function rewritePluginSpecifiers(
  raw: string,
  replacements: Map<string, string>,
): string {
  if (replacements.size === 0) return raw;
  return raw.split("\n").map((line) => {
    if (line.trimStart().startsWith("#")) return line;
    return line.replace(
      /(\bsrc:[ \t]*)(["']?)([^"'\s#,}]+)\2/,
      (whole, key: string, quote: string, value: string) => {
        const next = replacements.get(value);
        return next === undefined ? whole : `${key}${quote}${next}${quote}`;
      },
    );
  }).join("\n");
}

export async function pluginUpdateCommand(
  root: string,
  name?: string,
  options: PluginUpdateOptions = {},
): Promise<void> {
  const dryRun = options.dryRun === true;
  const resolveLatestVersion = options.resolveLatestVersion ??
    fetchLatestJsrVersion;
  const siteYamlPath = join(root, "config", "site.yaml");
  let raw = "";
  try {
    raw = await Deno.readTextFile(siteYamlPath);
  } catch {
    console.error(`Could not read ${siteYamlPath}`);
    Deno.exit(1);
  }

  const parsed = (parseYaml(raw) ?? {}) as Record<string, unknown>;
  const plugins = Array.isArray(parsed.plugins)
    ? parsed.plugins as PluginEntry[]
    : [];

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
  const replacements = new Map<string, string>();
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
      const latest = await resolveLatestVersion(scope, pkgName);

      if (!latest) {
        console.log(`  ${pkgId}: no latest version on JSR`);
        continue;
      }

      if (currentVersion === latest) {
        console.log(`  ${pkgId}@${latest} — up to date`);
        continue;
      }

      replacements.set(entry.src, `jsr:${pkgId}@${latest}`);
      console.log(`  ${pkgId}: ${currentVersion ?? "(unpinned)"} → ${latest}`);
      updated++;
    } catch (err) {
      console.log(
        `  ${pkgId}: error — ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  if (updated > 0) {
    if (dryRun) {
      console.log(
        `\nWould update ${updated} plugin${
          updated !== 1 ? "s" : ""
        } in config/site.yaml (dry run).`,
      );
      console.log("  No files written.");
      return;
    }
    const edited = rewritePluginSpecifiers(raw, replacements);
    // Safety net for layouts the line-based edit can't reach (e.g. a `src`
    // split across lines): refuse rather than silently write a partial edit.
    const reparsed = (parseYaml(edited) ?? {}) as { plugins?: PluginEntry[] };
    const applied = (reparsed.plugins ?? []).filter((p) =>
      [...replacements.values()].includes(p.src)
    ).length;
    const expected = jsrPlugins.filter((p) =>
      replacements.has(p.src)
    ).length;
    if (applied !== expected) {
      console.error(
        "\nCould not update the version specifiers in config/site.yaml in place " +
          "(unsupported formatting). No files written; edit the versions manually.",
      );
      Deno.exit(1);
    }
    await Deno.writeTextFile(siteYamlPath, edited);
    console.log(
      `\n✓ Updated ${updated} plugin${
        updated !== 1 ? "s" : ""
      } in config/site.yaml.`,
    );
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
