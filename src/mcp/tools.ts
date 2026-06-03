/**
 * MCP tool definitions for Dune CMS.
 *
 * Each tool wraps a Dune engine capability with a JSON Schema input definition
 * and a handler that returns MCP-formatted content.
 */

import type { McpTool, McpToolResult, ToolHandler } from "./server.ts";
import type { DuneEngine } from "../core/engine.ts";
import type { SearchEngine } from "../search/engine.ts";

// ── Text helper ──────────────────────────────────────────────────────────────

function text(content: string): McpToolResult {
  return { content: [{ type: "text", text: content }] };
}

function json(data: unknown): McpToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function errText(message: string): McpToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

// ── Tool: list_pages ─────────────────────────────────────────────────────────

const LIST_PAGES_META: McpTool = {
  name: "list_pages",
  description:
    "List pages in the Dune content index. Supports filtering by template, published status, " +
    "language, taxonomy value, and date range. Returns route, title, date, template, format, " +
    "and taxonomy for each matching page.",
  inputSchema: {
    type: "object",
    properties: {
      template: {
        type: "string",
        description: "Filter by template name (e.g. 'default', 'blog', 'product')",
      },
      published: {
        type: "boolean",
        description: "Filter by published status. Omit to return all pages.",
      },
      language: {
        type: "string",
        description: "Filter by language code (e.g. 'en', 'de')",
      },
      taxonomy: {
        type: "object",
        description: "Filter by taxonomy values. Keys are taxonomy names, values are arrays of required values.",
        additionalProperties: { type: "array", items: { type: "string" } },
      },
      date_from: {
        type: "string",
        description: "Filter pages on or after this date (ISO 8601, e.g. '2024-01-01')",
      },
      date_to: {
        type: "string",
        description: "Filter pages on or before this date (ISO 8601)",
      },
      limit: {
        type: "number",
        description: "Maximum number of pages to return (default: 50, max: 500)",
      },
      offset: {
        type: "number",
        description: "Pagination offset (default: 0)",
      },
    },
  },
};

function makeListPagesHandler(engine: DuneEngine): ToolHandler {
  return async (args) => {
    const {
      template,
      published,
      language,
      taxonomy,
      date_from,
      date_to,
      limit = 50,
      offset = 0,
    } = args as {
      template?: string;
      published?: boolean;
      language?: string;
      taxonomy?: Record<string, string[]>;
      date_from?: string;
      date_to?: string;
      limit?: number;
      offset?: number;
    };

    let pages = engine.pages;

    if (template !== undefined) pages = pages.filter((p) => p.template === template);
    if (published !== undefined) pages = pages.filter((p) => p.published === published);
    if (language !== undefined) pages = pages.filter((p) => p.language === language);
    if (date_from !== undefined) pages = pages.filter((p) => !p.date || p.date >= date_from!);
    if (date_to !== undefined) pages = pages.filter((p) => !p.date || p.date <= date_to!);
    if (taxonomy) {
      for (const [taxName, vals] of Object.entries(taxonomy)) {
        pages = pages.filter((p) => {
          const pageVals: string[] = (p.taxonomy as Record<string, string[]>)[taxName] ?? [];
          return vals.some((v) => pageVals.includes(v));
        });
      }
    }

    const total = pages.length;
    const effectiveLimit = Math.min(Number(limit), 500);
    const effectiveOffset = Number(offset);
    const slice = pages.slice(effectiveOffset, effectiveOffset + effectiveLimit);

    const items = slice.map((p) => ({
      route: p.route,
      title: p.title,
      date: p.date,
      template: p.template,
      format: p.format,
      published: p.published,
      language: p.language,
      taxonomy: p.taxonomy,
      sourcePath: p.sourcePath,
    }));

    return json({ total, limit: effectiveLimit, offset: effectiveOffset, pages: items });
  };
}

// ── Tool: get_page ───────────────────────────────────────────────────────────

const GET_PAGE_META: McpTool = {
  name: "get_page",
  description:
    "Get a single Dune page by its route. Returns the full frontmatter, rendered HTML, " +
    "media files, and metadata. Use list_pages first to discover available routes.",
  inputSchema: {
    type: "object",
    properties: {
      route: {
        type: "string",
        description: "The page route (URL path), e.g. '/about' or '/blog/hello-world'",
      },
      include_html: {
        type: "boolean",
        description: "Whether to include the rendered HTML body (default: true)",
      },
    },
    required: ["route"],
  },
};

function makeGetPageHandler(engine: DuneEngine): ToolHandler {
  return async (args) => {
    const { route, include_html = true } = args as { route: string; include_html?: boolean };

    if (!route) return errText("route is required");

    const result = await engine.resolve(route);
    if (result.type !== "page" || !result.page) {
      return errText(`Page not found: ${route}`);
    }

    const page = result.page;
    const pageData: Record<string, unknown> = {
      route: page.route,
      title: page.frontmatter.title,
      date: page.frontmatter.date,
      template: page.template,
      format: page.format,
      published: page.frontmatter.published ?? true,
      language: page.language,
      sourcePath: page.sourcePath,
      frontmatter: page.frontmatter,
      media: page.media.map((m) => ({ name: m.name, url: m.url, type: m.type })),
    };

    if (include_html) {
      try {
        pageData.html = await page.html();
      } catch {
        pageData.html = null;
        pageData.htmlError = "Could not render HTML for this format";
      }
    }

    return json(pageData);
  };
}

// ── Tool: search_content ─────────────────────────────────────────────────────

const SEARCH_META: McpTool = {
  name: "search_content",
  description:
    "Full-text search across all Dune pages. Returns matching pages with relevance scores " +
    "and text excerpts highlighting the match. Use for finding pages by content rather than route.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The search query string",
      },
      limit: {
        type: "number",
        description: "Maximum results to return (default: 10, max: 50)",
      },
      template: {
        type: "string",
        description: "Restrict search to a specific template",
      },
      language: {
        type: "string",
        description: "Restrict search to a specific language",
      },
    },
    required: ["query"],
  },
};

function makeSearchHandler(search: SearchEngine | null): ToolHandler {
  return async (args) => {
    const { query, limit = 10, template, language } = args as {
      query: string;
      limit?: number;
      template?: string;
      language?: string;
    };

    if (!query) return errText("query is required");
    if (!search) return errText("Search engine is not available. Run with --search flag.");

    const effectiveLimit = Math.min(Number(limit), 50);
    let results = await search.search(query, effectiveLimit * 3); // over-fetch for filtering

    if (template) results = results.filter((r) => r.page.template === template);
    if (language) results = results.filter((r) => r.page.language === language);
    results = results.slice(0, effectiveLimit);

    const items = results.map(({ page: p, score, excerpt }) => ({
      route: p.route,
      title: p.title,
      date: p.date,
      template: p.template,
      language: p.language,
      score: Math.round(score * 1000) / 1000,
      excerpt,
    }));

    return json({ query, total: items.length, results: items });
  };
}

// ── Tool: get_taxonomy ───────────────────────────────────────────────────────

const GET_TAXONOMY_META: McpTool = {
  name: "get_taxonomy",
  description:
    "Get all values for a taxonomy (e.g. categories, tags) with page counts per value. " +
    "Omit the 'name' argument to list all available taxonomies.",
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Taxonomy name (e.g. 'category', 'tag'). Omit to list all taxonomies.",
      },
    },
  },
};

function makeGetTaxonomyHandler(engine: DuneEngine): ToolHandler {
  return async (args) => {
    const { name } = args as { name?: string };

    if (!name) {
      // List all taxonomies with value counts
      const summary: Record<string, number> = {};
      for (const [taxName, values] of Object.entries(engine.taxonomyMap)) {
        summary[taxName] = Object.keys(values).length;
      }
      return json({ taxonomies: summary });
    }

    const values = engine.taxonomyMap[name];
    if (!values) {
      return errText(`Taxonomy "${name}" not found. Available: ${Object.keys(engine.taxonomyMap).join(", ")}`);
    }

    const counts: Record<string, number> = {};
    for (const [value, sourcePaths] of Object.entries(values)) {
      counts[value] = (sourcePaths as string[]).length;
    }

    return json({ name, values: counts, total: Object.keys(counts).length });
  };
}

// ── Tool: get_config ─────────────────────────────────────────────────────────

const GET_CONFIG_META: McpTool = {
  name: "get_config",
  description:
    "Get the Dune site configuration summary. Returns site title, URL, theme, taxonomies, " +
    "language settings, cache config, and feature flags. Secrets are never included.",
  inputSchema: {
    type: "object",
    properties: {},
  },
};

function makeGetConfigHandler(engine: DuneEngine): ToolHandler {
  return async (_args) => {
    const config = engine.config;
    const summary = {
      site: {
        title: config.site.title,
        url: config.site.url,
        author: config.site.author,
        taxonomies: config.site.taxonomies,
        feedEnabled: config.site.feed?.enabled !== false,
        workflowEnabled: !!config.site.workflow,
      },
      theme: {
        name: config.theme.name,
        templates: engine.themes.theme.templateNames,
        layouts: engine.themes.theme.layoutNames,
      },
      system: {
        contentDir: config.system.content.dir,
        languages: {
          supported: config.system.languages?.supported ?? [],
          default: config.system.languages?.default ?? "en",
        },
        cacheEnabled: config.system.cache?.enabled ?? false,
        debugMode: config.system.debug ?? false,
      },
      admin: {
        path: config.admin?.path ?? "/admin",
        auditEnabled: config.admin?.audit?.enabled !== false,
      },
      plugins: (config.pluginList ?? []).map((entry) => {
        const e = entry as { src?: string; spec?: string };
        return e.src ?? e.spec ?? "(unknown)";
      }),
    };
    return json(summary);
  };
}

// ── Tool: get_runtime_info ───────────────────────────────────────────────────

const GET_RUNTIME_INFO_META: McpTool = {
  name: "get_runtime_info",
  description:
    "Get a live snapshot of the Dune engine's runtime state: page counts, content formats, " +
    "top-level site sections, taxonomy summaries, theme details, and loaded plugins.",
  inputSchema: {
    type: "object",
    properties: {},
  },
};

function makeGetRuntimeInfoHandler(engine: DuneEngine): ToolHandler {
  return async (_args) => {
    const allPages = engine.pages;
    const published = allPages.filter((p) => p.published);
    const drafts = allPages.filter((p) => !p.published);

    const formats: Record<string, number> = {};
    for (const page of allPages) {
      formats[page.format] = (formats[page.format] ?? 0) + 1;
    }

    const sections: Record<string, number> = {};
    for (const page of published) {
      const seg = page.route?.split("/")[1] ?? "(root)";
      sections[seg] = (sections[seg] ?? 0) + 1;
    }

    const taxonomySummary: Record<string, { total: number; topValues: string[] }> = {};
    for (const [taxName, values] of Object.entries(engine.taxonomyMap)) {
      const sorted = Object.entries(values)
        .sort(([, a], [, b]) => (b as string[]).length - (a as string[]).length)
        .slice(0, 10)
        .map(([v]) => v);
      taxonomySummary[taxName] = { total: Object.keys(values).length, topValues: sorted };
    }

    const theme = engine.themes.theme;
    const info = {
      engine: {
        pagesTotal: allPages.length,
        pagesPublished: published.length,
        pagesDraft: drafts.length,
        formats,
        sections,
        taxonomies: taxonomySummary,
      },
      theme: {
        name: theme.manifest.name,
        version: theme.manifest.version ?? null,
        templates: theme.templateNames,
        layouts: theme.layoutNames,
      },
      generatedAt: new Date().toISOString(),
    };

    return json(info);
  };
}

// ── Tool: list_templates ─────────────────────────────────────────────────────

const LIST_TEMPLATES_META: McpTool = {
  name: "list_templates",
  description:
    "List all templates and layouts available in the active theme. " +
    "Useful for understanding what content types and page structures the site supports.",
  inputSchema: {
    type: "object",
    properties: {},
  },
};

function makeListTemplatesHandler(engine: DuneEngine): ToolHandler {
  return async (_args) => {
    const theme = engine.themes.theme;
    return json({
      theme: theme.manifest.name,
      templates: theme.templateNames,
      layouts: theme.layoutNames,
    });
  };
}

// ── Tool: list_blueprints ────────────────────────────────────────────────────

const LIST_BLUEPRINTS_META: McpTool = {
  name: "list_blueprints",
  description:
    "List all blueprint (frontmatter schema) definitions available in this project. " +
    "Blueprints define per-template frontmatter schemas. Use this to discover what fields " +
    "a template expects before creating or editing content. " +
    "Returns template name, title, required fields, optional fields, and field types.",
  inputSchema: {
    type: "object",
    properties: {
      template: {
        type: "string",
        description: "Optional: return only this template's full field schema. Omit to list all.",
      },
    },
  },
};

function makeListBlueprintsHandler(engine: DuneEngine): ToolHandler {
  return async (args) => {
    const { resolveBlueprint } = await import("../blueprints/validator.ts");

    const raw = engine.blueprints ?? {};

    if (args.template) {
      const def = raw[args.template as string];
      if (!def) {
        const available = Object.keys(raw);
        if (available.length === 0) {
          return errText("No blueprints found in this project.");
        }
        return errText(
          `Blueprint "${args.template}" not found. Available: ${available.join(", ")}`,
        );
      }

      const bp = resolveBlueprint(args.template as string, def, raw, 0);
      return json({
        template: args.template,
        title: bp.title,
        fields: Object.entries(bp.fields).reduce(
          (acc, [name, field]) => {
            acc[name] = {
              type: field.type,
              label: field.label,
              required: field.required ?? false,
              ...(field.default !== undefined ? { default: field.default } : {}),
              ...(field.options ? { options: field.options } : {}),
              ...(field.validate ? { validate: field.validate } : {}),
            };
            return acc;
          },
          {} as Record<string, unknown>,
        ),
      });
    }

    // List all blueprints
    const blueprints = Object.entries(raw).map(([template, def]) => {
      const bp = resolveBlueprint(template, def, raw, 0);
      const required = Object.entries(bp.fields)
        .filter(([, f]) => f.required)
        .map(([name]) => name);
      const optional = Object.entries(bp.fields)
        .filter(([, f]) => !f.required)
        .map(([name]) => name);
      return {
        template,
        title: bp.title,
        requiredFields: required,
        optionalFields: optional,
        fieldCount: Object.keys(bp.fields).length,
      };
    });

    return json({ total: blueprints.length, blueprints });
  };
}

// ── Tool: get_page_source ────────────────────────────────────────────────────

const GET_PAGE_SOURCE_META: McpTool = {
  name: "get_page_source",
  description:
    "Read the raw source content (YAML frontmatter + markdown body) of a page by its route. " +
    "Returns the full file content, parsed frontmatter, body text, and file metadata. " +
    "Use this before editing a page to read its current state.",
  inputSchema: {
    type: "object",
    properties: {
      route: {
        type: "string",
        description: "The URL route of the page (e.g. '/blog/hello-world')",
      },
    },
    required: ["route"],
  },
};

function makeGetPageSourceHandler(engine: DuneEngine): ToolHandler {
  return async (args) => {
    const route = String(args.route ?? "").trim();
    if (!route) return errText("route is required");

    const normalised = route.startsWith("/") ? route : `/${route}`;
    const pageIndex = engine.pages.find((p) => p.route === normalised);

    if (!pageIndex) {
      return errText(`Page not found: ${normalised}`);
    }

    const contentDir = engine.config.system.content.dir;
    const fullPath = `${contentDir}/${pageIndex.sourcePath}`;

    let rawContent: string;
    try {
      const bytes = await engine.storage.read(fullPath);
      rawContent = new TextDecoder().decode(bytes);
    } catch {
      return errText(`Could not read source file: ${pageIndex.sourcePath}`);
    }

    // Parse frontmatter
    let frontmatter: Record<string, unknown> = {};
    let body = rawContent;

    if (pageIndex.format === "md" || pageIndex.format === "mdx") {
      if (rawContent.startsWith("---")) {
        const end = rawContent.indexOf("\n---", 3);
        if (end !== -1) {
          const fmText = rawContent.slice(3, end).trim();
          body = rawContent.slice(end + 4).trimStart();
          try {
            const { parse } = await import("@std/yaml");
            const parsed = parse(fmText);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              frontmatter = parsed as Record<string, unknown>;
            }
          } catch {
            // Return empty frontmatter
          }
        }
      }
    }

    return json({
      route: pageIndex.route,
      sourcePath: pageIndex.sourcePath,
      format: pageIndex.format,
      content: rawContent,
      frontmatter,
      body: pageIndex.format === "tsx" ? null : body,
      mtime: pageIndex.mtime ?? null,
    });
  };
}

// ── Registration ─────────────────────────────────────────────────────────────

export interface ToolDependencies {
  engine: DuneEngine;
  search: SearchEngine | null;
}

export interface ToolRegistration {
  meta: McpTool;
  handler: ToolHandler;
}

/** Build all tool registrations from engine dependencies. */
export function buildTools(deps: ToolDependencies): ToolRegistration[] {
  const { engine, search } = deps;
  return [
    { meta: LIST_PAGES_META, handler: makeListPagesHandler(engine) },
    { meta: GET_PAGE_META, handler: makeGetPageHandler(engine) },
    { meta: SEARCH_META, handler: makeSearchHandler(search) },
    { meta: GET_TAXONOMY_META, handler: makeGetTaxonomyHandler(engine) },
    { meta: GET_CONFIG_META, handler: makeGetConfigHandler(engine) },
    { meta: GET_RUNTIME_INFO_META, handler: makeGetRuntimeInfoHandler(engine) },
    { meta: LIST_TEMPLATES_META, handler: makeListTemplatesHandler(engine) },
    { meta: LIST_BLUEPRINTS_META, handler: makeListBlueprintsHandler(engine) },
    { meta: GET_PAGE_SOURCE_META, handler: makeGetPageSourceHandler(engine) },
  ];
}
