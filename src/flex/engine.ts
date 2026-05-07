/**
 * Flex Object engine — schema loading and record CRUD.
 *
 * Schemas live at: `flex-objects/{type}.yaml`
 * Records live at: `flex-objects/{type}/{id}.yaml`
 *
 * Both files are plain YAML, stored via the storage adapter (so they work
 * with both filesystem and Deno KV backends).
 */

import { stringify as stringifyYaml } from "@std/yaml";
import { parseUserYaml as parseYaml } from "../security/safe-yaml.ts";
import type { StorageAdapter } from "../storage/types.ts";
import type {
  FlexRecord,
  FlexSchema,
  FlexSchemaMap,
  FlexValidationError,
} from "./types.ts";

// === Options ===

export interface FlexEngineOptions {
  storage: StorageAdapter;
  /**
   * Root directory for schemas and records.
   * Defaults to "flex-objects" (relative to storage root).
   */
  schemasDir?: string;
}

// === Public interface ===

export interface FlexEngine {
  /**
   * Load all schema definitions.
   * Returns a map of type name → FlexSchema.
   * Returns an empty map if the schemas directory doesn't exist.
   */
  loadSchemas(): Promise<FlexSchemaMap>;

  /** List all records for a given type (newest first). */
  list(type: string): Promise<FlexRecord[]>;

  /** Fetch a single record by ID. Returns null if not found. */
  get(type: string, id: string): Promise<FlexRecord | null>;

  /**
   * Create a new record.
   * Validates required fields; throws FlexValidationError[] on failure.
   */
  create(
    type: string,
    schema: FlexSchema,
    data: Record<string, unknown>,
  ): Promise<FlexRecord>;

  /**
   * Update an existing record (partial patch — unmentioned fields are kept).
   * Validates required fields; throws FlexValidationError[] on failure.
   * Returns null if the record doesn't exist.
   */
  update(
    type: string,
    id: string,
    schema: FlexSchema,
    data: Record<string, unknown>,
  ): Promise<FlexRecord | null>;

  /** Delete a record. No-ops if the record doesn't exist. */
  delete(type: string, id: string): Promise<void>;

  /**
   * Validate field values against a schema.
   * Returns an array of errors (empty = valid).
   */
  validate(schema: FlexSchema, data: Record<string, unknown>): FlexValidationError[];
}

// === Implementation ===

export function createFlexEngine(opts: FlexEngineOptions): FlexEngine {
  const { storage } = opts;
  const schemasDir = opts.schemasDir ?? "flex-objects";

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function schemaPath(type: string): string {
    return `${schemasDir}/${type}.yaml`;
  }

  function recordDir(type: string): string {
    return `${schemasDir}/${type}`;
  }

  function recordPath(type: string, id: string): string {
    return `${schemasDir}/${type}/${id}.yaml`;
  }

  function generateId(): string {
    // 8-character hex segment from UUID for short but unique IDs.
    return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  }

  /** Parse a raw YAML record file and inject `_type`. */
  function parseRecordFile(type: string, raw: string): FlexRecord {
    const parsed = parseYaml(raw) as Record<string, unknown>;
    return {
      _id: String(parsed._id ?? ""),
      _type: type,
      _createdAt: Number(parsed._createdAt ?? 0),
      _updatedAt: Number(parsed._updatedAt ?? 0),
      ...parsed,
    } as FlexRecord;
  }

  /** Serialize a record for disk (omit _type — it's derived from the directory). */
  function serializeRecord(record: FlexRecord): string {
    const { _type: _t, ...rest } = record;
    // Sort keys: _id, _createdAt, _updatedAt first, then user fields alphabetically.
    const meta = { _id: rest._id, _createdAt: rest._createdAt, _updatedAt: rest._updatedAt };
    const userFields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rest)) {
      if (!k.startsWith("_")) userFields[k] = v;
    }
    const sorted: Record<string, unknown> = {
      ...meta,
      ...Object.fromEntries(Object.entries(userFields).sort(([a], [b]) => a.localeCompare(b))),
    };
    return stringifyYaml(sorted).trimEnd() + "\n";
  }

  // ---------------------------------------------------------------------------
  // Schema loading
  // ---------------------------------------------------------------------------

  async function loadSchemas(): Promise<FlexSchemaMap> {
    const schemas: FlexSchemaMap = {};

    let entries;
    try {
      entries = await storage.list(schemasDir);
    } catch {
      // Directory doesn't exist — no schemas defined.
      return schemas;
    }

    const yamlFiles = entries.filter((e) => e.isFile && e.name.endsWith(".yaml"));

    await Promise.all(
      yamlFiles.map(async (entry) => {
        const type = entry.name.slice(0, -5); // strip ".yaml"
        try {
          const raw = await storage.readText(schemaPath(type));
          const parsed = parseYaml(raw) as Record<string, unknown>;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            schemas[type] = parsed as unknown as FlexSchema;
          }
        } catch {
          // Skip malformed schema files — don't crash the whole panel.
        }
      }),
    );

    return schemas;
  }

  // ---------------------------------------------------------------------------
  // Record CRUD
  // ---------------------------------------------------------------------------

  async function list(type: string): Promise<FlexRecord[]> {
    let entries;
    try {
      entries = await storage.list(recordDir(type));
    } catch {
      return [];
    }

    const yamlFiles = entries.filter((e) => e.isFile && e.name.endsWith(".yaml"));

    const records = await Promise.all(
      yamlFiles.map(async (entry) => {
        try {
          const raw = await storage.readText(`${recordDir(type)}/${entry.name}`);
          return parseRecordFile(type, raw);
        } catch {
          return null;
        }
      }),
    );

    const valid = records.filter((r): r is FlexRecord => r !== null);

    // Sort newest first (by _createdAt descending).
    valid.sort((a, b) => b._createdAt - a._createdAt);

    return valid;
  }

  async function get(type: string, id: string): Promise<FlexRecord | null> {
    try {
      const exists = await storage.exists(recordPath(type, id));
      if (!exists) return null;
      const raw = await storage.readText(recordPath(type, id));
      return parseRecordFile(type, raw);
    } catch {
      return null;
    }
  }

  function validate(schema: FlexSchema, data: Record<string, unknown>): FlexValidationError[] {
    const errors: FlexValidationError[] = [];

    for (const [fieldName, field] of Object.entries(schema.fields)) {
      const value = data[fieldName];
      const isEmpty =
        value === undefined ||
        value === null ||
        value === "" ||
        (Array.isArray(value) && value.length === 0);

      if (field.required && isEmpty) {
        errors.push({ field: fieldName, message: `${field.label} is required.` });
        continue;
      }

      if (isEmpty) continue;

      // Type-specific validation
      if (field.type === "number" && typeof value !== "number") {
        errors.push({ field: fieldName, message: `${field.label} must be a number.` });
      }

      if (field.type === "select" && field.options) {
        if (!Object.keys(field.options).includes(String(value))) {
          errors.push({ field: fieldName, message: `${field.label} has an invalid selection.` });
        }
      }

      if (field.validate) {
        const { min, max, pattern } = field.validate;

        if (field.type === "number" && typeof value === "number") {
          if (min !== undefined && value < min) {
            errors.push({ field: fieldName, message: `${field.label} must be at least ${min}.` });
          }
          if (max !== undefined && value > max) {
            errors.push({ field: fieldName, message: `${field.label} must be at most ${max}.` });
          }
        }

        if (
          (field.type === "text" || field.type === "textarea" || field.type === "markdown") &&
          typeof value === "string"
        ) {
          if (min !== undefined && value.length < min) {
            errors.push({
              field: fieldName,
              message: `${field.label} must be at least ${min} characters.`,
            });
          }
          if (max !== undefined && value.length > max) {
            errors.push({
              field: fieldName,
              message: `${field.label} must be at most ${max} characters.`,
            });
          }
          if (pattern && !new RegExp(pattern).test(value)) {
            errors.push({ field: fieldName, message: `${field.label} has an invalid format.` });
          }
        }

        if (field.type === "list" && Array.isArray(value)) {
          if (min !== undefined && value.length < min) {
            errors.push({
              field: fieldName,
              message: `${field.label} requires at least ${min} item(s).`,
            });
          }
          if (max !== undefined && value.length > max) {
            errors.push({
              field: fieldName,
              message: `${field.label} allows at most ${max} item(s).`,
            });
          }
        }
      }
    }

    return errors;
  }

  async function create(
    type: string,
    schema: FlexSchema,
    data: Record<string, unknown>,
  ): Promise<FlexRecord> {
    const errors = validate(schema, data);
    if (errors.length > 0) throw errors;

    const now = Date.now();
    const id = generateId();

    const record: FlexRecord = {
      _id: id,
      _type: type,
      _createdAt: now,
      _updatedAt: now,
      ...coerceValues(schema, data),
    };

    await storage.write(recordPath(type, id), serializeRecord(record));
    return record;
  }

  async function update(
    type: string,
    id: string,
    schema: FlexSchema,
    data: Record<string, unknown>,
  ): Promise<FlexRecord | null> {
    const existing = await get(type, id);
    if (!existing) return null;

    const merged: Record<string, unknown> = { ...existing, ...data };
    // Remove internal keys from the merged data before validation
    const { _id: _i, _type: _t, _createdAt: _c, _updatedAt: _u, ...mergedFields } = merged;

    const errors = validate(schema, mergedFields);
    if (errors.length > 0) throw errors;

    const record: FlexRecord = {
      ...existing,
      ...coerceValues(schema, mergedFields),
      _id: existing._id,
      _type: type,
      _createdAt: existing._createdAt,
      _updatedAt: Date.now(),
    };

    await storage.write(recordPath(type, id), serializeRecord(record));
    return record;
  }

  async function deleteRecord(type: string, id: string): Promise<void> {
    try {
      await storage.delete(recordPath(type, id));
    } catch {
      // Already gone — no-op.
    }
  }

  // ---------------------------------------------------------------------------
  // Value coercion (string form inputs → typed values)
  // ---------------------------------------------------------------------------

  function coerceValues(
    schema: FlexSchema,
    data: Record<string, unknown>,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [fieldName, field] of Object.entries(schema.fields)) {
      const raw = data[fieldName];
      if (raw === undefined || raw === null || raw === "") {
        // Apply default if defined; otherwise omit the field.
        if (field.default !== undefined) result[fieldName] = field.default;
        continue;
      }

      switch (field.type) {
        case "number":
          result[fieldName] = typeof raw === "number" ? raw : parseFloat(String(raw));
          break;
        case "toggle":
          result[fieldName] = raw === true || raw === "true" || raw === "on" || raw === 1;
          break;
        case "list":
          result[fieldName] = Array.isArray(raw) ? raw : [String(raw)];
          break;
        default:
          result[fieldName] = raw;
      }
    }

    return result;
  }

  return {
    loadSchemas,
    list,
    get,
    create,
    update,
    delete: deleteRecord,
    validate,
  };
}
