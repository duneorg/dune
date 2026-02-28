/**
 * Blueprint loader — discovers and loads blueprint YAML files.
 *
 * Blueprints live at `blueprints/{template}.yaml` in the project root.
 * Loading is best-effort: a missing or unreadable blueprints directory
 * returns an empty map rather than throwing (blueprints are optional).
 */

import type { StorageAdapter } from "../storage/types.ts";
import type { BlueprintDefinition, BlueprintField, BlueprintFieldType, BlueprintMap } from "./types.ts";

/** Valid field types — used for YAML parsing validation. */
const VALID_TYPES = new Set<BlueprintFieldType>([
  "text", "textarea", "markdown", "number", "toggle",
  "date", "select", "list", "file", "color",
]);

/**
 * Load all blueprints from the given directory.
 *
 * @param storage  Storage adapter to read from.
 * @param dir      Directory containing blueprint YAML files (e.g. "blueprints").
 * @returns        Map of template name → BlueprintDefinition.
 *                 Returns an empty map if the directory is missing.
 */
export async function loadBlueprints(
  storage: StorageAdapter,
  dir: string,
): Promise<BlueprintMap> {
  const blueprints: BlueprintMap = {};

  // Discover blueprint files — non-fatal if directory is absent
  let entries: { name: string; isFile: boolean }[];
  try {
    entries = await storage.list(dir);
  } catch {
    return blueprints; // No blueprints directory — valid
  }

  const { parse } = await import("@std/yaml");

  for (const entry of entries) {
    if (!entry.isFile) continue;
    if (!entry.name.endsWith(".yaml") && !entry.name.endsWith(".yml")) continue;

    const templateName = entry.name.replace(/\.(yaml|yml)$/, "");
    const filePath = `${dir}/${entry.name}`;

    try {
      const text = await storage.readText(filePath);
      const raw = parse(text);
      const blueprint = parseBlueprintYaml(raw, templateName, filePath);
      if (blueprint) {
        blueprints[templateName] = blueprint;
      }
    } catch (err) {
      // Log warning but continue — a broken blueprint file should not crash the CMS
      console.warn(`[dune:blueprints] Failed to load ${filePath}: ${err}`);
    }
  }

  return blueprints;
}

// ---------------------------------------------------------------------------
// YAML parsing helpers
// ---------------------------------------------------------------------------

function parseBlueprintYaml(
  raw: unknown,
  templateName: string,
  filePath: string,
): BlueprintDefinition | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    console.warn(`[dune:blueprints] ${filePath}: must be a YAML object`);
    return null;
  }

  const data = raw as Record<string, unknown>;

  const title = typeof data.title === "string" ? data.title : templateName;
  const extendsName = typeof data.extends === "string" ? data.extends : undefined;
  const fields = parseFieldsMap(data.fields, filePath);

  return { title, extends: extendsName, fields };
}

function parseFieldsMap(
  raw: unknown,
  filePath: string,
): Record<string, BlueprintField> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }

  const result: Record<string, BlueprintField> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const field = parseField(key, value, filePath);
    if (field) result[key] = field;
  }
  return result;
}

function parseField(
  name: string,
  raw: unknown,
  filePath: string,
): BlueprintField | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    console.warn(`[dune:blueprints] ${filePath}: field "${name}" must be an object`);
    return null;
  }

  const data = raw as Record<string, unknown>;
  const type = data.type as string;

  if (!VALID_TYPES.has(type as BlueprintFieldType)) {
    console.warn(
      `[dune:blueprints] ${filePath}: field "${name}" has unknown type "${type}" — ` +
      `valid types: ${[...VALID_TYPES].join(", ")}`,
    );
    return null;
  }

  const label = typeof data.label === "string" ? data.label : name;
  const required = typeof data.required === "boolean" ? data.required : undefined;
  const defaultVal = "default" in data ? data.default : undefined;

  // Options — for select type
  let options: Record<string, string> | undefined;
  if (data.options && typeof data.options === "object" && !Array.isArray(data.options)) {
    options = {};
    for (const [k, v] of Object.entries(data.options as Record<string, unknown>)) {
      options[k] = typeof v === "string" ? v : String(v);
    }
  }

  // Nested validate block
  let validate: BlueprintField["validate"];
  if (data.validate && typeof data.validate === "object" && !Array.isArray(data.validate)) {
    const v = data.validate as Record<string, unknown>;
    validate = {};
    if (typeof v.min === "number") validate.min = v.min;
    if (typeof v.max === "number") validate.max = v.max;
    if (typeof v.pattern === "string") validate.pattern = v.pattern;
    if (Object.keys(validate).length === 0) validate = undefined;
  }

  const field: BlueprintField = {
    type: type as BlueprintFieldType,
    label,
  };
  if (required !== undefined) field.required = required;
  if (defaultVal !== undefined) field.default = defaultVal;
  if (options) field.options = options;
  if (validate) field.validate = validate;

  return field;
}
