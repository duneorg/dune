/**
 * dune mcp:serve — Start the Dune MCP server over stdio.
 *
 * Implements the Model Context Protocol (MCP) so AI coding agents
 * (Claude Code, Cursor, Codeium, etc.) can query the live content engine
 * without standing up a web server.
 *
 * The server bootstraps the Dune engine from the site root, then speaks
 * JSON-RPC 2.0 on stdin / stdout until the client disconnects.
 *
 * Configuration (add to .mcp.json or ~/.claude.json):
 *
 *   {
 *     "mcpServers": {
 *       "dune": {
 *         "command": "deno",
 *         "args": ["run", "-A", "jsr:@dune/core/cli", "mcp:serve"],
 *         "cwd": "/path/to/site"
 *       }
 *     }
 *   }
 */

import { McpServer } from "../mcp/server.ts";
import { buildTools } from "../mcp/tools.ts";
import { buildResources } from "../mcp/resources.ts";
import { buildWriteTools } from "../mcp/write-tools.ts";
import { createStorage } from "../storage/mod.ts";
import { loadConfig } from "../config/mod.ts";
import { FormatRegistry } from "../content/formats/registry.ts";
import { MarkdownHandler } from "../content/formats/markdown.ts";
import { TsxHandler } from "../content/formats/tsx.ts";
import { MdxHandler } from "../content/formats/mdx.ts";
import { createDuneEngine } from "../core/engine.ts";
import { createSearchEngine } from "../search/engine.ts";
import { resolve } from "@std/path";

export interface McpServeOptions {
  debug?: boolean;
  /** Build the search index before starting (enables search_content tool). */
  search?: boolean;
}

/** Read version from deno.json or JSR URL (same logic as cli.ts). */
function getVersion(): string {
  const url = import.meta.url;
  const jsrMatch = url.match(/jsr\.io\/@dune\/core\/([^/]+)\//);
  if (jsrMatch) return jsrMatch[1];
  try {
    const denoJsonPath = new URL("../../deno.json", import.meta.url).pathname;
    const raw = Deno.readTextFileSync(denoJsonPath);
    return JSON.parse(raw).version ?? "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Lightweight engine bootstrap for MCP: only content engine + optional search.
 * Skips admin panel, auth, collab, scheduler, and other server-only subsystems
 * to keep startup fast and avoid needing admin credentials.
 */
async function lightweightBootstrap(root: string, buildSearch: boolean, debug: boolean) {
  root = resolve(root);
  const storage = createStorage({ rootDir: root });
  const config = await loadConfig({ storage, rootDir: root, skipConfigTs: true });
  if (debug) config.system.debug = true;

  const formats = new FormatRegistry();
  formats.register(new MarkdownHandler());
  formats.register(new TsxHandler());
  formats.register(new MdxHandler());

  const engine = await createDuneEngine({ storage, config, formats, storageRoot: root });
  await engine.init();

  let search = null;
  if (buildSearch) {
    const se = createSearchEngine({
      pages: engine.pages,
      storage,
      contentDir: config.system.content.dir,
      formats,
    });
    await se.build();
    search = se;
  }

  return { engine, search, config, storage };
}

export async function mcpServeCommand(
  root: string,
  options: McpServeOptions = {},
): Promise<void> {
  const { debug = false, search: buildSearch = true } = options;

  // Log to stderr so it doesn't pollute the JSON-RPC stdout stream
  const log = (...args: unknown[]) => {
    if (debug) Deno.stderr.writeSync(new TextEncoder().encode(`[mcp] ${args.join(" ")}\n`));
  };

  log(`Starting MCP server (root: ${root})`);

  const { engine, search, config, storage } = await lightweightBootstrap(root, buildSearch, debug);

  log(`Engine ready: ${engine.pages.length} pages, theme: ${engine.themes.theme.manifest.name}`);

  const version = getVersion();

  const server = new McpServer({
    name: "dune-cms",
    version,
    debug,
  });

  // Register tools and resources
  const tools = buildTools({ engine, search });
  const contentDir = config.system?.content?.dir ?? "content";
  const writeTools = buildWriteTools({ engine, storage, root, contentDir });
  const resources = buildResources(engine);

  for (const { meta, handler } of [...tools, ...writeTools]) {
    server.registerTool(meta, handler);
  }
  for (const { meta, handler } of resources) {
    server.registerResource(meta, handler);
  }

  log(`MCP server ready — ${tools.length + writeTools.length} tools (${tools.length} read, ${writeTools.length} write/scaffold), ${resources.length} resources`);

  await server.serve();
}
