/**
 * Blueprint validator — validates page frontmatter against a blueprint schema.
 *
 * Supports:
 *  - Required field checking
 *  - Type validation (text, number, toggle, date, select, list, file, color, …)
 *  - `select` options constraint
 *  - `validate.min` / `validate.max` / `validate.pattern` constraints
 *  - Blueprint inheritance via `extends`
 */

import type { PageFrontmatter } from "../content/types.ts";
import type {
  BlueprintDefinition,
  BlueprintField,
  BlueprintFieldType,
  BlueprintMap,
  BlueprintValidationError,
  ResolvedBlueprint,
} from "./types.ts";

/** Maximum inheritance depth — prevents infinite loops on circular extends. */
const MAX_EXTENDS_DEPTH = 10;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate page frontmatter against a blueprint.
 *
 * Resolves inheritance chains automatically.  Unknown fields in frontmatter
 * are silently allowed (PageFrontmatter has an index signature).
 *
 * @param frontmatter  The frontmatter extracted from a page.
 * @param template     The template name (e.g., "post").
 * @param blueprints   All available blueprints (for resolving `extends`).
 * @returns            Array of validation errors. Empty means valid.
 */
export function validateFrontmatter(
  frontmatter: PageFrontmatter,
  template: string,
  blueprints: BlueprintMap,
): BlueprintValidationError[] {
  const blueprint = blueprints[template];
  if (!blueprint) return [];

  const resolved = resolveBlueprint(template, blueprint, blueprints, 0);
  return validateAgainstResolved(frontmatter, resolved);
}

/**
 * Resolve a blueprint, flattening the `extends` inheritance chain.
 * Parent fields are overridden by child fields of the same name.
 */
export function resolveBlueprint(
  template: string,
  blueprint: BlueprintDefinition,
  blueprints: BlueprintMap,
  depth: number,
): ResolvedBlueprint {
  if (depth >= MAX_EXTENDS_DEPTH) {
    // Silently stop — don't crash CMS over circular blueprint extends
    return { title: blueprint.title, template, fields: { ...blueprint.fields } };
  }

  let inheritedFields: Record<string, BlueprintField> = {};

  if (blueprint.extends) {
    const parent = blueprints[blueprint.extends];
    if (parent) {
      const resolved = resolveBlueprint(blueprint.extends, parent, blueprints, depth + 1);
      inheritedFields = resolved.fields;
    }
    // Missing parent — silently skip; warn at load time
  }

  return {
    title: blueprint.title,
    template,
    // Child fields override parent fields
    fields: { ...inheritedFields, ...blueprint.fields },
  };
}

// ---------------------------------------------------------------------------
// Validation logic
// ---------------------------------------------------------------------------

function validateAgainstResolved(
  frontmatter: PageFrontmatter,
  blueprint: ResolvedBlueprint,
): BlueprintValidationError[] {
  const errors: BlueprintValidationError[] = [];

  for (const [fieldName, field] of Object.entries(blueprint.fields)) {
    const rawValue = frontmatter[fieldName];
    const isAbsent = rawValue === undefined || rawValue === null || rawValue === "";

    // 1. Required check
    if (field.required && isAbsent) {
      errors.push({
        field: fieldName,
        message: `is required (type: ${field.type})`,
      });
      continue; // Skip type-checking absent required fields
    }

    // Skip further checks for absent optional fields (use defaults at runtime)
    if (isAbsent) continue;

    // 2. Type check
    const typeError = checkType(fieldName, rawValue, field);
    if (typeError) {
      errors.push(typeError);
      continue; // Skip constraint checks if type is wrong
    }

    // 3. Options constraint (select)
    if (field.type === "select" && field.options) {
      if (typeof rawValue === "string" && !(rawValue in field.options)) {
        const allowed = Object.keys(field.options).map((k) => `"${k}"`).join(", ");
        errors.push({
          field: fieldName,
          message: `must be one of: ${allowed} (got: "${rawValue}")`,
        });
      }
    }

    // 4. Validate constraints (min, max, pattern)
    if (field.validate) {
      const constraintErrors = checkConstraints(fieldName, rawValue, field);
      errors.push(...constraintErrors);
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Type checking
// ---------------------------------------------------------------------------

function checkType(
  fieldName: string,
  value: unknown,
  field: BlueprintField,
): BlueprintValidationError | null {
  switch (field.type) {
    case "text":
    case "textarea":
    case "markdown":
    case "color":
    case "file":
      if (typeof value !== "string") {
        return {
          field: fieldName,
          message: `must be a string (got: ${formatGot(value)})`,
        };
      }
      break;

    case "number":
      if (typeof value !== "number" || Number.isNaN(value)) {
        return {
          field: fieldName,
          message: `must be a number (got: ${formatGot(value)})`,
        };
      }
      break;

    case "toggle":
      if (typeof value !== "boolean") {
        return {
          field: fieldName,
          message: `must be a boolean (true or false) (got: ${formatGot(value)})`,
        };
      }
      break;

    case "date":
      if (typeof value !== "string") {
        return {
          field: fieldName,
          message: `must be a date string (YYYY-MM-DD) (got: ${formatGot(value)})`,
        };
      }
      if (!isValidDateString(value)) {
        return {
          field: fieldName,
          message: `must be a valid date in YYYY-MM-DD format (got: "${value}")`,
        };
      }
      break;

    case "select":
      if (typeof value !== "string") {
        return {
          field: fieldName,
          message: `must be a string (got: ${formatGot(value)})`,
        };
      }
      break;

    case "list":
      if (!Array.isArray(value)) {
        return {
          field: fieldName,
          message: `must be a list (array) (got: ${formatGot(value)})`,
        };
      }
      // Check that every item is a string
      for (let i = 0; i < (value as unknown[]).length; i++) {
        if (typeof (value as unknown[])[i] !== "string") {
          return {
            field: fieldName,
            message: `list items must be strings (item [${i}] got: ${formatGot((value as unknown[])[i])})`,
          };
        }
      }
      break;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Constraint checking
// ---------------------------------------------------------------------------

function checkConstraints(
  fieldName: string,
  value: unknown,
  field: BlueprintField,
): BlueprintValidationError[] {
  const errors: BlueprintValidationError[] = [];
  const { validate } = field;
  if (!validate) return errors;

  const { min, max, pattern } = validate;

  switch (field.type as BlueprintFieldType) {
    case "number": {
      const n = value as number;
      if (min !== undefined && n < min) {
        errors.push({ field: fieldName, message: `must be at least ${min} (got: ${n})` });
      }
      if (max !== undefined && n > max) {
        errors.push({ field: fieldName, message: `must be at most ${max} (got: ${n})` });
      }
      break;
    }

    case "text":
    case "textarea":
    case "markdown":
    case "color":
    case "file":
    case "date":
    case "select": {
      const s = value as string;
      if (min !== undefined && s.length < min) {
        errors.push({
          field: fieldName,
          message: `must be at least ${min} characters (got: ${s.length})`,
        });
      }
      if (max !== undefined && s.length > max) {
        errors.push({
          field: fieldName,
          message: `must be at most ${max} characters (got: ${s.length})`,
        });
      }
      if (pattern !== undefined) {
        try {
          if (!new RegExp(pattern).test(s)) {
            errors.push({
              field: fieldName,
              message: `must match pattern /${pattern}/ (got: "${s}")`,
            });
          }
        } catch {
          // Invalid regex pattern in blueprint — skip check
        }
      }
      break;
    }

    case "list": {
      const arr = value as string[];
      if (min !== undefined && arr.length < min) {
        errors.push({
          field: fieldName,
          message: `must have at least ${min} item(s) (got: ${arr.length})`,
        });
      }
      if (max !== undefined && arr.length > max) {
        errors.push({
          field: fieldName,
          message: `must have at most ${max} item(s) (got: ${arr.length})`,
        });
      }
      if (pattern !== undefined) {
        try {
          const re = new RegExp(pattern);
          for (const item of arr) {
            if (!re.test(item)) {
              errors.push({
                field: fieldName,
                message: `list item "${item}" must match pattern /${pattern}/`,
              });
              break; // Report one pattern error per field
            }
          }
        } catch {
          // Invalid regex
        }
      }
      break;
    }

    case "toggle":
      // No constraints apply to boolean
      break;
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDateString(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  // Verify it's an actual calendar date
  const d = new Date(s + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return false;
  // JS Date overflows invalid days (e.g., 2024-02-30 → 2024-03-01) instead of
  // returning NaN.  Round-trip the ISO string to catch overflows.
  return d.toISOString().startsWith(s);
}

function formatGot(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `array[${(value as unknown[]).length}]`;
  return `${typeof value}`;
}
