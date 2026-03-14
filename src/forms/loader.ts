/**
 * Form definition loader — discovers and loads form YAML files.
 *
 * Form definitions live at `forms/{name}.yaml` in the project root.
 * Loading is best-effort: a missing or unreadable `forms/` directory
 * returns an empty map rather than throwing (forms are optional).
 */

import type { StorageAdapter } from "../storage/types.ts";
import type { FormDefinition, FormField, FormFieldType, FormMap } from "./types.ts";

/** Valid form field types. */
const VALID_TYPES = new Set<FormFieldType>([
  "text", "email", "tel", "textarea", "number", "select", "checkbox", "file", "hidden",
]);

/**
 * Load all form definitions from the given directory.
 *
 * @param storage  Storage adapter to read from.
 * @param dir      Directory containing form YAML files (e.g. "forms").
 * @returns        Map of form name → FormDefinition.
 *                 Returns an empty map if the directory is missing.
 */
export async function loadForms(
  storage: StorageAdapter,
  dir: string,
): Promise<FormMap> {
  const forms: FormMap = {};

  let entries: { name: string; isFile: boolean }[];
  try {
    entries = await storage.list(dir);
  } catch {
    return forms; // No forms directory — valid
  }

  const { parse } = await import("@std/yaml");

  for (const entry of entries) {
    if (!entry.isFile) continue;
    if (!entry.name.endsWith(".yaml") && !entry.name.endsWith(".yml")) continue;

    const formName = entry.name.replace(/\.(yaml|yml)$/, "");
    // Validate name: only alphanumeric + hyphens/underscores
    if (!/^[a-zA-Z0-9_-]+$/.test(formName)) continue;

    const filePath = `${dir}/${entry.name}`;

    try {
      const text = await storage.readText(filePath);
      const raw = parse(text);
      const form = parseFormYaml(raw, formName, filePath);
      if (form) {
        forms[formName] = form;
      }
    } catch (err) {
      console.warn(`[dune:forms] Failed to load ${filePath}: ${err}`);
    }
  }

  return forms;
}

/**
 * Load a single form definition by name.
 * Returns null if not found or invalid.
 */
export async function loadForm(
  storage: StorageAdapter,
  dir: string,
  name: string,
): Promise<FormDefinition | null> {
  // Validate name to prevent path traversal
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) return null;

  const { parse } = await import("@std/yaml");

  for (const ext of [".yaml", ".yml"]) {
    const filePath = `${dir}/${name}${ext}`;
    try {
      const text = await storage.readText(filePath);
      const raw = parse(text);
      return parseFormYaml(raw, name, filePath);
    } catch {
      // Not found or unreadable — try next extension
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// YAML parsing helpers
// ---------------------------------------------------------------------------

function parseFormYaml(
  raw: unknown,
  name: string,
  filePath: string,
): FormDefinition | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    console.warn(`[dune:forms] ${filePath}: must be a YAML object`);
    return null;
  }

  const data = raw as Record<string, unknown>;

  const title = typeof data.title === "string" ? data.title : name;
  const success_url = typeof data.success_url === "string" ? data.success_url : undefined;
  const honeypot = typeof data.honeypot === "string" ? data.honeypot : undefined;

  // Parse per-form notification overrides
  let notifications: FormDefinition["notifications"];
  if (data.notifications && typeof data.notifications === "object" && !Array.isArray(data.notifications)) {
    const n = data.notifications as Record<string, unknown>;
    notifications = {};
    if (typeof n.email === "string") notifications.email = n.email;
    if (typeof n.webhook === "string") notifications.webhook = n.webhook;
    if (Object.keys(notifications).length === 0) notifications = undefined;
  }

  const fields = parseFieldsMap(data.fields, filePath);

  const form: FormDefinition = { title, fields };
  if (success_url) form.success_url = success_url;
  if (honeypot) form.honeypot = honeypot;
  if (notifications) form.notifications = notifications;

  return form;
}

function parseFieldsMap(
  raw: unknown,
  filePath: string,
): Record<string, FormField> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }

  const result: Record<string, FormField> = {};
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
): FormField | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    console.warn(`[dune:forms] ${filePath}: field "${name}" must be an object`);
    return null;
  }

  const data = raw as Record<string, unknown>;
  const type = data.type as string;

  if (!VALID_TYPES.has(type as FormFieldType)) {
    console.warn(
      `[dune:forms] ${filePath}: field "${name}" has unknown type "${type}" — ` +
      `valid types: ${[...VALID_TYPES].join(", ")}`,
    );
    return null;
  }

  const label = typeof data.label === "string" ? data.label : name;
  const required = typeof data.required === "boolean" ? data.required : undefined;
  const placeholder = typeof data.placeholder === "string" ? data.placeholder : undefined;

  // Options for select fields
  let options: Record<string, string> | undefined;
  if (data.options && typeof data.options === "object" && !Array.isArray(data.options)) {
    options = {};
    for (const [k, v] of Object.entries(data.options as Record<string, unknown>)) {
      options[k] = typeof v === "string" ? v : String(v);
    }
  }

  // Validation constraints
  let validate: FormField["validate"];
  if (data.validate && typeof data.validate === "object" && !Array.isArray(data.validate)) {
    const v = data.validate as Record<string, unknown>;
    validate = {};
    if (typeof v.min === "number") validate.min = v.min;
    if (typeof v.max === "number") validate.max = v.max;
    if (typeof v.pattern === "string") validate.pattern = v.pattern;
    if (Object.keys(validate).length === 0) validate = undefined;
  }

  const field: FormField = { type: type as FormFieldType, label };
  if (required !== undefined) field.required = required;
  if (placeholder) field.placeholder = placeholder;
  if (options) field.options = options;
  if (validate) field.validate = validate;

  return field;
}
