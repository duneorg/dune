/**
 * Schema parser — reads schemas/*.yaml and returns internal DbSchema objects.
 */

/** @module */

import { parse as parseYaml } from "@std/yaml";
import { join } from "@std/path";
import type { ApiMethod, DbFieldDef, DbFieldType, DbSchema, DbSchemaApi } from "./types.ts";

// ---------------------------------------------------------------------------
// Raw YAML shape (user-authored)
// ---------------------------------------------------------------------------

interface RawFieldDef {
  type: string;
  required?: boolean;
  maxLength?: number;
  index?: boolean;
  enum?: string[];
  default?: unknown;
  onUpdate?: string;
}

const VALID_AUTH_MODES = ["none", "required", "owner"] as const;
const VALID_API_METHODS: ApiMethod[] = ["get", "list", "create", "update", "delete"];

interface RawApiBlock {
  enabled?: unknown;
  auth?: unknown;
  methods?: unknown;
  ownerField?: unknown;
}

interface RawSchema {
  model: string;
  table?: string;
  fields: Record<string, RawFieldDef>;
  api?: RawApiBlock;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const VALID_TYPES: DbFieldType[] = [
  "string",
  "text",
  "integer",
  "number",
  "boolean",
  "datetime",
  "json",
];

function isValidType(t: string): t is DbFieldType {
  return (VALID_TYPES as string[]).includes(t);
}

/** Parse and validate the optional `api:` block in a raw schema. */
function parseApiBlock(
  raw: RawApiBlock,
  sourceHint: string,
  fieldNames: Set<string>,
): DbSchemaApi {
  const enabled = raw.enabled !== undefined ? Boolean(raw.enabled) : true;

  // auth
  if (raw.auth === undefined) {
    throw new Error(`${sourceHint}: api block must specify "auth" (one of: ${VALID_AUTH_MODES.join(", ")})`);
  }
  if (typeof raw.auth !== "string" || !(VALID_AUTH_MODES as readonly string[]).includes(raw.auth)) {
    throw new Error(
      `${sourceHint}: api.auth must be one of ${VALID_AUTH_MODES.join(", ")} (got "${raw.auth}")`,
    );
  }
  const auth = raw.auth as DbSchemaApi["auth"];

  // methods
  let methods: ApiMethod[];
  if (raw.methods === undefined) {
    methods = [...VALID_API_METHODS];
  } else {
    if (!Array.isArray(raw.methods)) {
      throw new Error(`${sourceHint}: api.methods must be an array`);
    }
    methods = [];
    for (const m of raw.methods as unknown[]) {
      if (typeof m !== "string" || !(VALID_API_METHODS as string[]).includes(m)) {
        throw new Error(
          `${sourceHint}: api.methods contains invalid value "${m}". Valid: ${VALID_API_METHODS.join(", ")}`,
        );
      }
      methods.push(m as ApiMethod);
    }
    if (methods.length === 0) {
      throw new Error(`${sourceHint}: api.methods must not be empty`);
    }
  }

  // ownerField — required when auth is "owner"
  let ownerField: string | undefined;
  if (auth === "owner") {
    if (raw.ownerField === undefined || raw.ownerField === null) {
      throw new Error(
        `${sourceHint}: api.ownerField is required when api.auth is "owner"`,
      );
    }
    if (typeof raw.ownerField !== "string" || !raw.ownerField.trim()) {
      throw new Error(`${sourceHint}: api.ownerField must be a non-empty string`);
    }
    ownerField = raw.ownerField.trim();
    if (!fieldNames.has(ownerField)) {
      throw new Error(
        `${sourceHint}: api.ownerField "${ownerField}" is not a field in this schema`,
      );
    }
  } else if (raw.ownerField !== undefined) {
    // Accepted but ignored for non-owner modes
    if (typeof raw.ownerField === "string" && raw.ownerField.trim()) {
      ownerField = raw.ownerField.trim();
    }
  }

  return { enabled, auth, methods, ownerField };
}

/** Convert a model name like "Comment" to a table name "comments". */
export function modelToTableName(model: string): string {
  // snake_case-ify and pluralise
  const snake = model
    .replace(/([A-Z])/g, (m, p1, offset) => (offset > 0 ? "_" : "") + p1.toLowerCase())
    .replace(/^_/, "");
  // Simple pluralisation: append 's' unless already ending in 's'
  return snake.endsWith("s") ? snake : snake + "s";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Parse a single raw YAML object into a DbSchema. Throws on invalid input. */
export function parseRawSchema(raw: unknown, sourceHint = "<unknown>"): DbSchema {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${sourceHint}: schema must be an object`);
  }

  const r = raw as Record<string, unknown>;

  if (typeof r.model !== "string" || !r.model.trim()) {
    throw new Error(`${sourceHint}: schema must have a non-empty "model" string`);
  }

  const model = r.model.trim();

  const table =
    typeof r.table === "string" && r.table.trim()
      ? r.table.trim()
      : modelToTableName(model);

  if (!r.fields || typeof r.fields !== "object" || Array.isArray(r.fields)) {
    throw new Error(`${sourceHint}: schema "${model}" must have a "fields" object`);
  }

  const rawFields = r.fields as Record<string, unknown>;
  const fields: DbFieldDef[] = [];

  for (const [fieldName, rawField] of Object.entries(rawFields)) {
    if (!rawField || typeof rawField !== "object" || Array.isArray(rawField)) {
      throw new Error(`${sourceHint}: field "${fieldName}" must be an object`);
    }

    const rf = rawField as RawFieldDef;

    if (typeof rf.type !== "string") {
      throw new Error(`${sourceHint}: field "${fieldName}" must have a "type" string`);
    }
    if (!isValidType(rf.type)) {
      throw new Error(
        `${sourceHint}: field "${fieldName}" has unsupported type "${rf.type}". ` +
          `Valid types: ${VALID_TYPES.join(", ")}`,
      );
    }

    const field: DbFieldDef = { name: fieldName, type: rf.type };

    if (rf.required !== undefined) {
      field.required = Boolean(rf.required);
    }
    if (typeof rf.maxLength === "number") {
      field.maxLength = rf.maxLength;
    }
    if (rf.index !== undefined) {
      field.index = Boolean(rf.index);
    }
    if (Array.isArray(rf.enum)) {
      field.enum = rf.enum.map(String);
    }
    if (rf.default !== undefined) {
      field.default = rf.default;
    }
    if (rf.onUpdate !== undefined) {
      if (rf.onUpdate !== "now") {
        throw new Error(
          `${sourceHint}: field "${fieldName}" onUpdate must be "now" (got "${rf.onUpdate}")`,
        );
      }
      field.onUpdate = "now";
    }

    fields.push(field);
  }

  // Parse optional api: block
  let api: DbSchemaApi | undefined;
  if (r.api !== undefined) {
    if (!r.api || typeof r.api !== "object" || Array.isArray(r.api)) {
      throw new Error(`${sourceHint}: schema "${model}" api block must be an object`);
    }
    const fieldNames = new Set(fields.map((f) => f.name));
    api = parseApiBlock(r.api as RawApiBlock, sourceHint, fieldNames);
  }

  return { model, table, fields, ...(api !== undefined ? { api } : {}) };
}

/** Parse a YAML string into a DbSchema. Throws on parse or validation error. */
export function parseSchemaYaml(yaml: string, sourceHint?: string): DbSchema {
  let raw: unknown;
  try {
    raw = parseYaml(yaml);
  } catch (err) {
    throw new Error(
      `${sourceHint ?? "<string>"}: YAML parse error: ${err instanceof Error ? err.message : err}`,
    );
  }
  return parseRawSchema(raw, sourceHint);
}

/**
 * Read all *.yaml files from `schemasDir` and parse them.
 * Returns the array of DbSchema in file-system order.
 */
export async function loadSchemas(schemasDir: string): Promise<DbSchema[]> {
  const schemas: DbSchema[] = [];

  let entries: Deno.DirEntry[];
  try {
    entries = [];
    for await (const entry of Deno.readDir(schemasDir)) {
      entries.push(entry);
    }
  } catch {
    // Schemas directory doesn't exist — return empty list
    return schemas;
  }

  // Sort for deterministic ordering
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    if (!entry.isFile || !entry.name.endsWith(".yaml")) continue;
    const filePath = join(schemasDir, entry.name);
    const text = await Deno.readTextFile(filePath);
    schemas.push(parseSchemaYaml(text, filePath));
  }

  return schemas;
}
