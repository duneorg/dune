/**
 * MCP write tools + scaffolding tools.
 *
 * Write tools apply content and config mutations directly to the filesystem
 * via the StorageAdapter — same effect as POST /admin/api/dev/apply but
 * without needing a running server. In dev mode the file watcher picks up
 * changes automatically.
 *
 * Scaffolding tools use the live engine state (installed plugins, existing
 * routes, available templates) before generating files, so agents get
 * context-aware scaffolds without having to discover the project structure first.
 *
 * Tools:
 *   write_page        — write or overwrite a content file (md/mdx)
 *   delete_page       — delete a content file by route or path
 *   update_frontmatter — merge frontmatter fields on an existing page
 *   update_config     — shallow-merge site.yaml top-level fields
 *   install_plugin    — add a plugin specifier to site.yaml
 *   scaffold_plugin   — generate plugins/{name}/index.ts
 *   scaffold_route    — generate content/{name}.md
 *   scaffold_form     — generate forms/{name}.yaml
 *   scaffold_theme    — generate themes/{name}/ scaffold
 */

import { parse as parseYaml, stringify as stringifyYaml } from "@std/yaml";
import type { StorageAdapter } from "../storage/types.ts";
import type { DuneEngine } from "../core/engine.ts";
import type { McpTool, McpToolResult, ToolHandler } from "./server.ts";
import type { ToolRegistration } from "./tools.ts";
import {
  generatePlugin,
  generateRoute,
  generateForm,
  generateTheme,
  type GenerateOptions,
} from "../cli/generate.ts";
import {
  assertHttpsPluginIntegrity,
  assertPinnedPluginSpecifier,
} from "../plugins/reference.ts";

export interface WriteToolDeps {
  engine: DuneEngine;
  storage: StorageAdapter;
  /** Absolute path to the project root. */
  root: string;
  /** Content directory, relative to root (default: "content"). */
  contentDir: string;
}

// ── Path safety ──────────────────────────────────────────────────────────────

/**
 * Validate that a caller-supplied relative path stays within a given base
 * directory using URL-normalisation containment.
 *
 * `path.includes("..")` is insufficient — it doesn't catch absolute paths
 * or OS-specific traversal variants. URL-normalisation resolves all `.` and
 * `..` segments before the prefix check, giving a robust single control point.
 *
 * Returns the safe storage path (relative, no leading slash) on success,
 * or null if the path would escape the base.
 */
function safePath(baseDir: string, userPath: string): string | null {
  // Strip any leading slashes so the path is always relative
  const stripped = userPath.replace(/^\/+/, "");
  const base = new URL(`${baseDir}/`, "file:///");
  const candidate = new URL(`${baseDir}/${stripped}`, "file:///");
  if (!candidate.pathname.startsWith(base.pathname)) return null;
  // Return as a relative path (strip the leading "/")
  return candidate.pathname.slice(1);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Parse frontmatter + body from a markdown file. */
function parseFrontmatter(src: string): { fm: Record<string, unknown>; body: string } {
  const match = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { fm: {}, body: src };
  try {
    const fm = (parseYaml(match[1]) ?? {}) as Record<string, unknown>;
    return { fm, body: match[2] };
  } catch {
    return { fm: {}, body: src };
  }
}

/** Render frontmatter + body back to a string. */
function renderFrontmatter(fm: Record<string, unknown>, body: string): string {
  const yamlStr = stringifyYaml(fm).trimEnd();
  return `---\n${yamlStr}\n---\n${body}`;
}

/**
 * Check whether `content`'s frontmatter block (if any) is valid YAML.
 * Returns a human-readable warning when it isn't, or null when it's fine
 * (including when there's no frontmatter block at all — some pages, and
 * every non-.md/.mdx file, legitimately have none).
 *
 * write_page writes raw content verbatim with no parsing of its own —
 * malformed frontmatter would otherwise land on disk silently and only
 * surface later at render/index time, disconnected from the write that
 * caused it. This is deliberately parse-and-warn, not reject: write_page
 * is a trusted-agent primitive (MCP's own security-model doc already
 * treats tool access as code execution), so it shouldn't refuse a write
 * the caller explicitly asked for — it should just make sure they can't
 * miss that something's wrong.
 */
function checkFrontmatterSyntax(content: string): string | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) return null;
  try {
    parseYaml(match[1]);
    return null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return `frontmatter is not valid YAML (${msg}) — written as-is, but this page will likely fail to index or render correctly until fixed.`;
  }
}

/** Resolve a route like "/blog/hello" to a source path via the engine, or null. */
function routeToSourcePath(engine: DuneEngine, route: string): string | null {
  const normalised = route.startsWith("/") ? route : `/${route}`;
  const page = engine.pages.find((p) => p.route === normalised);
  return page?.sourcePath ?? null;
}

function ok(text: string): McpToolResult {
  return { content: [{ type: "text", text }] };
}
function err(text: string): McpToolResult {
  return { content: [{ type: "text", text: `Error: ${text}` }], isError: true };
}

// ── write_page ────────────────────────────────────────────────────────────────

const WRITE_PAGE_META: McpTool = {
  name: "write_page",
  description:
    "Write or overwrite a content file. Provide path relative to the content directory " +
    "(e.g. \"blog/hello.md\") and the full file content including frontmatter.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path relative to content dir, e.g. blog/hello.md" },
      content: { type: "string", description: "Full file content (frontmatter + body)" },
    },
    required: ["path", "content"],
  },
};

function makeWritePageHandler(deps: WriteToolDeps): ToolHandler {
  return async (args) => {
    const path = String(args.path ?? "").trim();
    const content = String(args.content ?? "");
    if (!path) return err("path is required");

    const storagePath = safePath(deps.contentDir, path);
    if (!storagePath) return err("path must stay within the content directory");

    try {
      await deps.storage.write(storagePath, new TextEncoder().encode(content));
      const warning = checkFrontmatterSyntax(content);
      return ok(
        warning
          ? `Written: ${storagePath}\n⚠️  Warning: ${warning}`
          : `Written: ${storagePath}`,
      );
    } catch (e) {
      return err(`Failed to write ${path}: ${e}`);
    }
  };
}

// ── delete_page ───────────────────────────────────────────────────────────────

const DELETE_PAGE_META: McpTool = {
  name: "delete_page",
  description: "Delete a content file by route (e.g. \"/blog/hello\") or by path relative to the content dir.",
  inputSchema: {
    type: "object",
    properties: {
      route: { type: "string", description: "Page route, e.g. /blog/hello (preferred)" },
      path: { type: "string", description: "File path relative to content dir (alternative to route)" },
    },
    required: [],
  },
};

function makeDeletePageHandler(deps: WriteToolDeps): ToolHandler {
  return async (args) => {
    let storagePath: string | null = null;

    if (args.route) {
      // Route lookup goes through the engine index — only known pages can be deleted.
      storagePath = routeToSourcePath(deps.engine, String(args.route));
      if (!storagePath) return err(`No page found at route "${args.route}"`);
    } else if (args.path) {
      // Explicit path — validate with URL-normalisation containment so ".." and
      // absolute paths cannot escape the content directory.
      storagePath = safePath(deps.contentDir, String(args.path));
      if (!storagePath) return err("path must stay within the content directory");
    } else {
      return err("Provide either route or path");
    }

    try {
      await deps.storage.delete(storagePath);
      return ok(`Deleted: ${storagePath}`);
    } catch (e) {
      return err(`Failed to delete: ${e}`);
    }
  };
}

// ── update_frontmatter ────────────────────────────────────────────────────────

const UPDATE_FRONTMATTER_META: McpTool = {
  name: "update_frontmatter",
  description:
    "Merge frontmatter field updates into an existing content page. " +
    "Existing fields not mentioned in updates are preserved. " +
    "Pass null as a value to remove a field. " +
    "Use 'path' (relative to content dir) for pages created in the same session " +
    "that the engine doesn't know about yet.",
  inputSchema: {
    type: "object",
    properties: {
      route: { type: "string", description: "Page route, e.g. /blog/hello (preferred for existing pages)" },
      path: { type: "string", description: "File path relative to content dir, e.g. blog/hello.md (use for newly written pages)" },
      updates: { type: "object", description: "Frontmatter fields to set or remove (null = remove)" },
    },
    required: ["updates"],
  },
};

function makeUpdateFrontmatterHandler(deps: WriteToolDeps): ToolHandler {
  return async (args) => {
    const updates = (args.updates ?? {}) as Record<string, unknown>;
    let storagePath: string | null = null;

    if (args.path) {
      // Explicit path — used for newly written pages not yet in the engine index.
      // Use URL-normalisation containment so ".." and absolute paths cannot
      // escape the content directory.
      storagePath = safePath(deps.contentDir, String(args.path).trim());
      if (!storagePath) return err("path must stay within the content directory");
    } else if (args.route) {
      const route = String(args.route);
      storagePath = routeToSourcePath(deps.engine, route);
      if (!storagePath) return err(
        `No page found at route "${route}". If this page was just created, use 'path' instead of 'route'.`,
      );
    } else {
      return err("Provide either 'route' or 'path'");
    }

    try {
      const rawBytes = await deps.storage.read(storagePath);
      const src = new TextDecoder().decode(rawBytes);
      const { fm, body } = parseFrontmatter(src);

      for (const [key, value] of Object.entries(updates)) {
        if (value === null) {
          delete fm[key];
        } else {
          fm[key] = value;
        }
      }

      const updated = renderFrontmatter(fm, body);
      await deps.storage.write(storagePath, new TextEncoder().encode(updated));
      return ok(`Updated frontmatter for ${args.route ?? args.path}`);
    } catch (e) {
      return err(`Failed to update frontmatter: ${e}`);
    }
  };
}

// ── update_config ─────────────────────────────────────────────────────────────

const UPDATE_CONFIG_META: McpTool = {
  name: "update_config",
  description:
    "Shallow-merge top-level fields into site.yaml. " +
    "Pass an object whose top-level keys are the site.yaml sections to update. " +
    "Nested keys are deep-merged. Use get_config to read current values first.",
  inputSchema: {
    type: "object",
    properties: {
      updates: {
        type: "object",
        description: "Top-level site.yaml fields to merge, e.g. { site: { title: 'New title' } }",
      },
    },
    required: ["updates"],
  },
};

function deepMerge(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const result = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof result[key] === "object" &&
      result[key] !== null &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(
        result[key] as Record<string, unknown>,
        value as Record<string, unknown>,
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}

function makeUpdateConfigHandler(deps: WriteToolDeps): ToolHandler {
  return async (args) => {
    const updates = (args.updates ?? {}) as Record<string, unknown>;

    const configPath = "site.yaml";
    try {
      let current: Record<string, unknown> = {};
      try {
        const rawBytes = await deps.storage.read(configPath);
        current = (parseYaml(new TextDecoder().decode(rawBytes)) ?? {}) as Record<string, unknown>;
      } catch { /* site.yaml may not exist yet */ }

      const merged = deepMerge(current, updates);
      const yaml = stringifyYaml(merged);
      await deps.storage.write(configPath, new TextEncoder().encode(yaml));
      return ok("site.yaml updated");
    } catch (e) {
      return err(`Failed to update config: ${e}`);
    }
  };
}

// ── install_plugin ────────────────────────────────────────────────────────────

const INSTALL_PLUGIN_META: McpTool = {
  name: "install_plugin",
  description:
    "Add a plugin specifier to the plugins list in site.yaml. " +
    "The specifier may be a local path (./plugins/my-plugin/index.ts) or " +
    "a remote specifier pinned to an exact version (jsr:@scope/plugin@1.0.0, npm:plugin-name@1.2.3). " +
    "https: specifiers require integrity (sha256:<64 hex> or SRI sha256-<base64>).",
  inputSchema: {
    type: "object",
    properties: {
      src: { type: "string", description: "Plugin specifier, e.g. ./plugins/my-plugin/index.ts" },
      integrity: {
        type: "string",
        description: "Required for https: src. sha256:<64 hex> or SRI sha256-<base64>.",
      },
    },
    required: ["src"],
  },
};

function makeInstallPluginHandler(deps: WriteToolDeps): ToolHandler {
  return async (args) => {
    const src = String(args.src ?? "").trim();
    if (!src) return err("src is required");
    const integrity = args.integrity !== undefined
      ? String(args.integrity).trim()
      : undefined;
    try {
      assertPinnedPluginSpecifier(src);
      assertHttpsPluginIntegrity(src, integrity || undefined);
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e));
    }

    const configPath = "site.yaml";
    try {
      let config: Record<string, unknown> = {};
      try {
        const rawBytes = await deps.storage.read(configPath);
        config = (parseYaml(new TextDecoder().decode(rawBytes)) ?? {}) as Record<string, unknown>;
      } catch { /* ok */ }

      const plugins = Array.isArray(config.plugins) ? [...config.plugins] : [];

      // Check for duplicate
      const alreadyInstalled = plugins.some(
        (p) => (typeof p === "string" && p === src) || (typeof p === "object" && (p as { src?: string }).src === src),
      );
      if (alreadyInstalled) return ok(`Plugin already installed: ${src}`);

      plugins.push(integrity ? { src, integrity } : { src });
      config.plugins = plugins;

      await deps.storage.write(configPath, new TextEncoder().encode(stringifyYaml(config)));
      return ok(`Plugin added: ${src}`);
    } catch (e) {
      return err(`Failed to install plugin: ${e}`);
    }
  };
}

// ── Scaffolding tools ─────────────────────────────────────────────────────────

const SCAFFOLD_PLUGIN_META: McpTool = {
  name: "scaffold_plugin",
  description:
    "Generate a new plugin scaffold at plugins/{name}/index.ts. " +
    "Lists existing plugins first so you can avoid name collisions.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Plugin name (slug, e.g. my-analytics)" },
    },
    required: ["name"],
  },
};

const SCAFFOLD_ROUTE_META: McpTool = {
  name: "scaffold_route",
  description:
    "Create a new content page at content/{path}.md with starter frontmatter. " +
    "Pass the route path without the content prefix, e.g. \"blog/hello-world\".",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Route path, e.g. blog/hello-world" },
    },
    required: ["name"],
  },
};

const SCAFFOLD_FORM_META: McpTool = {
  name: "scaffold_form",
  description: "Generate a form definition at forms/{name}.yaml with example fields.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Form name (slug)" },
    },
    required: ["name"],
  },
};

const SCAFFOLD_THEME_META: McpTool = {
  name: "scaffold_theme",
  description:
    "Generate a theme scaffold at themes/{name}/ with theme.yaml, a default template, and a CSS file.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Theme name (slug)" },
    },
    required: ["name"],
  },
};

function makeScaffoldHandler(
  fn: (root: string, name: string, opts?: GenerateOptions) => Promise<void>,
  deps: WriteToolDeps,
): ToolHandler {
  return async (args) => {
    const name = String(args.name ?? "").trim();
    if (!name) return err("name is required");
    try {
      // Capture output by passing a scoped logger through GenerateOptions.
      // Each generator reads opts.log ?? console.log so no global state is
      // touched — concurrent scaffold calls, job ticks, and audit flushes
      // all write to their own sinks without interference.
      const lines: string[] = [];
      await fn(deps.root, name, { log: (msg) => lines.push(msg) });
      return ok(lines.join("\n"));
    } catch (e) {
      return err(String(e));
    }
  };
}

// ── Registration ──────────────────────────────────────────────────────────────

export function buildWriteTools(deps: WriteToolDeps): ToolRegistration[] {
  return [
    { meta: WRITE_PAGE_META,         handler: makeWritePageHandler(deps) },
    { meta: DELETE_PAGE_META,        handler: makeDeletePageHandler(deps) },
    { meta: UPDATE_FRONTMATTER_META, handler: makeUpdateFrontmatterHandler(deps) },
    { meta: UPDATE_CONFIG_META,      handler: makeUpdateConfigHandler(deps) },
    { meta: INSTALL_PLUGIN_META,     handler: makeInstallPluginHandler(deps) },
    { meta: SCAFFOLD_PLUGIN_META,    handler: makeScaffoldHandler(generatePlugin, deps) },
    { meta: SCAFFOLD_ROUTE_META,     handler: makeScaffoldHandler(generateRoute, deps) },
    { meta: SCAFFOLD_FORM_META,      handler: makeScaffoldHandler(generateForm, deps) },
    { meta: SCAFFOLD_THEME_META,     handler: makeScaffoldHandler(generateTheme, deps) },
  ];
}
