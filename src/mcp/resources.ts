/**
 * MCP resource definitions for Dune CMS.
 *
 * Resources expose read-only data as URIs that agents can subscribe to
 * or read on demand. Unlike tools, resources represent persistent state.
 */

import { join } from "@std/path";
import type { McpResource, McpResourceContent, ResourceHandler } from "./server.ts";
import type { DuneEngine } from "../core/engine.ts";
import type { StorageAdapter } from "../storage/types.ts";

// ── Resource: site config ────────────────────────────────────────────────────

const CONFIG_RESOURCE: McpResource = {
  uri: "dune://site/config",
  name: "Site Configuration",
  description: "Full Dune site configuration (secrets omitted). Contains site.yaml merged with system defaults.",
  mimeType: "application/json",
};

function makeConfigHandler(engine: DuneEngine): ResourceHandler {
  return async (uri) => {
    const config = engine.config;
    // Strip any secret-adjacent fields before serializing
    const safe = {
      site: config.site,
      system: {
        ...config.system,
        // Omit any secret-like config keys at the system level
        db: undefined,
      },
      theme: config.theme,
      admin: {
        path: config.admin?.path,
        dataDir: config.admin?.dataDir,
        runtimeDir: config.admin?.runtimeDir,
        audit: config.admin?.audit,
        // Omit auth_provider details (may contain connection strings)
      },
      plugins: (config.pluginList ?? []).map((entry) => {
        const e = entry as { src?: string; spec?: string };
        return e.src ?? e.spec ?? "(unknown)";
      }),
    };
    return {
      uri,
      mimeType: "application/json",
      text: JSON.stringify(safe, null, 2),
    } satisfies McpResourceContent;
  };
}

// ── Resource: schema ─────────────────────────────────────────────────────────

const SCHEMA_RESOURCE: McpResource = {
  uri: "dune://site/schema",
  name: "Config JSON Schema",
  description: "JSON Schema (draft-07) for site.yaml. Use for validation and autocompletion.",
  mimeType: "application/schema+json",
};

async function schemaHandler(uri: string): Promise<McpResourceContent> {
  const { CONFIG_SCHEMA, SCHEMA_VERSION } = await import("../schema/config-schema.ts");
  return {
    uri,
    mimeType: "application/schema+json",
    text: JSON.stringify({ schemaVersion: SCHEMA_VERSION, schema: CONFIG_SCHEMA }, null, 2),
  };
}

// ── Resource: pages index ────────────────────────────────────────────────────

const PAGES_RESOURCE: McpResource = {
  uri: "dune://content/pages",
  name: "Pages Index",
  description:
    "Complete list of all pages in the content index. " +
    "Each entry includes route, title, template, format, published status, and taxonomy.",
  mimeType: "application/json",
};

function makePagesHandler(engine: DuneEngine): ResourceHandler {
  return async (uri) => {
    const pages = engine.pages.map((p) => ({
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
    return {
      uri,
      mimeType: "application/json",
      text: JSON.stringify({ total: pages.length, pages }, null, 2),
    };
  };
}

// ── Resource: taxonomy ───────────────────────────────────────────────────────

const TAXONOMY_RESOURCE: McpResource = {
  uri: "dune://content/taxonomy",
  name: "Taxonomy Index",
  description:
    "All taxonomy names and their values with page counts. " +
    "Taxonomies are defined in site.yaml under site.taxonomies.",
  mimeType: "application/json",
};

function makeTaxonomyHandler(engine: DuneEngine): ResourceHandler {
  return async (uri) => {
    const result: Record<string, Record<string, number>> = {};
    for (const [taxName, values] of Object.entries(engine.taxonomyMap)) {
      result[taxName] = {};
      for (const [value, sourcePaths] of Object.entries(values)) {
        result[taxName][value] = (sourcePaths as string[]).length;
      }
    }
    return {
      uri,
      mimeType: "application/json",
      text: JSON.stringify(result, null, 2),
    };
  };
}

// ── Resource: blueprints ──────────────────────────────────────────────────────

const BLUEPRINTS_RESOURCE: McpResource = {
  uri: "dune://content/blueprints",
  name: "Blueprint Schemas",
  description:
    "All blueprint (frontmatter schema) definitions, with inheritance fully resolved. " +
    "Each entry describes a template's expected fields with types, labels, " +
    "required flags, defaults, and validation constraints.",
  mimeType: "application/json",
};

function makeBlueprintsHandler(engine: DuneEngine): ResourceHandler {
  return async (uri) => {
    const raw = engine.blueprints ?? {};

    // Lazily import resolveBlueprint to keep startup fast
    const { resolveBlueprint } = await import("../blueprints/validator.ts");

    const resolved = Object.entries(raw).map(([template, def]) => {
      const bp = resolveBlueprint(template, def, raw, 0);
      return {
        template,
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
      };
    });

    return {
      uri,
      mimeType: "application/json",
      text: JSON.stringify({ total: resolved.length, blueprints: resolved }, null, 2),
    };
  };
}

// ── Resource: forms (flex-objects schemas) ────────────────────────────────────

const FORMS_RESOURCE: McpResource = {
  uri: "dune://content/forms",
  name: "Form Schemas",
  description:
    "All form/flex-object schema definitions from the schemas/ directory. " +
    "Each entry describes the schema name, title, fields, and storage tier. " +
    "Use this before scaffold_form to see what already exists.",
  mimeType: "application/json",
};

/** Runtime dependencies required by MCP resource handlers. */
export interface ResourceDeps {
  engine: DuneEngine;
  storage: StorageAdapter;
  root: string;
}

function makeFormsHandler(storage: StorageAdapter, root: string): ResourceHandler {
  return async () => {
    const schemasDir = "schemas";
    const forms: Record<string, unknown>[] = [];

    try {
      const entries = await storage.list(schemasDir);
      for (const entry of entries) {
        if (!entry.isFile || !entry.name.endsWith(".yaml")) continue;
        try {
          const raw = await storage.read(entry.path);
          const { parse } = await import("@std/yaml");
          const schema = parse(new TextDecoder().decode(raw)) as Record<string, unknown>;
          forms.push({ name: entry.name.slice(0, -5), ...schema });
        } catch { /* skip malformed */ }
      }
    } catch { /* schemas/ dir doesn't exist */ }

    return {
      uri: FORMS_RESOURCE.uri,
      mimeType: "application/json",
      text: JSON.stringify(forms, null, 2),
    };
  };
}

// ── Resource: audit log tail ──────────────────────────────────────────────────

const AUDIT_LOG_RESOURCE: McpResource = {
  uri: "dune://site/audit",
  name: "Audit Log",
  description:
    "The 50 most recent audit log entries from the admin panel. " +
    "Each entry includes event type, actor, target, outcome, and timestamp. " +
    "Returns an empty array when audit logging is not enabled.",
  mimeType: "application/json",
};

function makeAuditLogHandler(storage: StorageAdapter, root: string): ResourceHandler {
  return async () => {
    // Audit log is a JSONL file; read the last 50 lines
    const logPath = join(root, ".dune", "admin", "audit.log");
    const entries: unknown[] = [];

    try {
      const raw = await Deno.readTextFile(logPath);
      const lines = raw.trimEnd().split("\n").filter(Boolean);
      const tail = lines.slice(-50);
      for (const line of tail) {
        try { entries.push(JSON.parse(line)); } catch { /* skip */ }
      }
    } catch { /* log file absent or unreadable */ }

    return {
      uri: AUDIT_LOG_RESOURCE.uri,
      mimeType: "application/json",
      text: JSON.stringify(entries, null, 2),
    };
  };
}

// ── Registration ─────────────────────────────────────────────────────────────

/** A registered MCP resource — descriptor plus its handler function. */
export interface ResourceRegistration {
  meta: McpResource;
  handler: ResourceHandler;
}

/** Build all resource registrations from engine and storage dependencies. */
export function buildResources(
  engine: DuneEngine,
  storage?: StorageAdapter,
  root?: string,
): ResourceRegistration[] {
  const base: ResourceRegistration[] = [
    { meta: CONFIG_RESOURCE, handler: makeConfigHandler(engine) },
    { meta: SCHEMA_RESOURCE, handler: schemaHandler },
    { meta: PAGES_RESOURCE, handler: makePagesHandler(engine) },
    { meta: TAXONOMY_RESOURCE, handler: makeTaxonomyHandler(engine) },
    { meta: BLUEPRINTS_RESOURCE, handler: makeBlueprintsHandler(engine) },
  ];

  if (storage && root) {
    base.push(
      { meta: FORMS_RESOURCE, handler: makeFormsHandler(storage, root) },
      { meta: AUDIT_LOG_RESOURCE, handler: makeAuditLogHandler(storage, root) },
    );
  }

  return base;
}
