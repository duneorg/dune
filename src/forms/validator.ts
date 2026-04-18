/**
 * Form field validator — validates submitted field values against a
 * FormDefinition schema, returning a list of validation errors.
 */

import type { FormDefinition, FormField, FormValidationError } from "./types.ts";

/**
 * Validate submitted fields against the form definition.
 *
 * @param form    The form definition (from YAML).
 * @param fields  Submitted key→value pairs (string values only; files excluded).
 * @returns       Array of validation errors (empty if valid).
 */
export function validateFormSubmission(
  form: FormDefinition,
  fields: Record<string, string>,
): FormValidationError[] {
  const errors: FormValidationError[] = [];

  for (const [name, field] of Object.entries(form.fields)) {
    const value = fields[name] ?? "";
    const fieldErrors = validateField(name, field, value);
    errors.push(...fieldErrors);
  }

  return errors;
}

function validateField(
  name: string,
  field: FormField,
  value: string,
): FormValidationError[] {
  const errors: FormValidationError[] = [];
  const isEmpty = value.trim() === "";

  // Required check
  if (field.required && isEmpty) {
    errors.push({ field: name, message: `${field.label} is required.` });
    return errors; // Skip further validation for empty required fields
  }

  // Skip optional empty fields
  if (isEmpty) return errors;

  // Type-specific validation
  switch (field.type) {
    case "email": {
      // Basic email format check
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        errors.push({ field: name, message: `${field.label} must be a valid email address.` });
      }
      break;
    }
    case "number": {
      const num = Number(value);
      if (isNaN(num)) {
        errors.push({ field: name, message: `${field.label} must be a number.` });
      } else {
        if (field.validate?.min !== undefined && num < field.validate.min) {
          errors.push({ field: name, message: `${field.label} must be at least ${field.validate.min}.` });
        }
        if (field.validate?.max !== undefined && num > field.validate.max) {
          errors.push({ field: name, message: `${field.label} must be at most ${field.validate.max}.` });
        }
      }
      break;
    }
    case "select": {
      if (field.options && !Object.keys(field.options).includes(value)) {
        errors.push({ field: name, message: `${field.label} must be one of the allowed options.` });
      }
      break;
    }
    case "text":
    case "email":
    case "tel":
    case "textarea": {
      if (field.validate?.min !== undefined && value.length < field.validate.min) {
        errors.push({ field: name, message: `${field.label} must be at least ${field.validate.min} characters.` });
      }
      if (field.validate?.max !== undefined && value.length > field.validate.max) {
        errors.push({ field: name, message: `${field.label} must be at most ${field.validate.max} characters.` });
      }
      break;
    }
  }

  // Pattern validation (string fields). Admin-authored patterns can still
  // contain catastrophic-backtracking constructs like `(a+)+`, so we reject
  // a basic class of dangerous shapes up front and cap the input length
  // passed to RegExp#test to bound worst-case matching cost.
  if (field.validate?.pattern && typeof value === "string") {
    if (isDangerousPattern(field.validate.pattern)) {
      // Log server-side and skip — the form owner should fix the blueprint.
      console.warn(`[dune] Rejected form pattern for field "${name}" — nested quantifier`);
    } else if (value.length > MAX_PATTERN_INPUT) {
      errors.push({ field: name, message: `${field.label} is too long.` });
    } else {
      try {
        const re = new RegExp(field.validate.pattern);
        if (!re.test(value)) {
          errors.push({ field: name, message: `${field.label} has an invalid format.` });
        }
      } catch {
        // Invalid regex in YAML — skip pattern check
      }
    }
  }

  return errors;
}

const MAX_PATTERN_INPUT = 10_000;

/**
 * Reject patterns with nested quantifiers — the classic ReDoS shape
 * `(x+)+`, `(x*)+`, `(x+)*` and similar. Not exhaustive; a determined
 * author can still write a pathological regex, but this catches the
 * common accidental footgun.
 */
function isDangerousPattern(pattern: string): boolean {
  return /\([^)]*[+*][^)]*\)\s*[+*?{]/.test(pattern);
}
