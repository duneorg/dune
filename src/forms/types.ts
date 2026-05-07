/**
 * Form definition types.
 *
 * A form definition lives at `forms/{name}.yaml` in the project root and
 * describes the fields, validation rules, and submission behaviour for a
 * public-facing HTML form.
 *
 * @example forms/contact.yaml
 * ```yaml
 * title: Contact Form
 * success_url: /thank-you
 * fields:
 *   name:
 *     type: text
 *     label: Your Name
 *     required: true
 *   email:
 *     type: email
 *     label: Email Address
 *     required: true
 *   message:
 *     type: textarea
 *     label: Message
 *     required: true
 *     validate:
 *       min: 10
 *       max: 2000
 * ```
 */

/**
 * Supported form field types.
 *
 * | type     | HTML element               | Notes                            |
 * |----------|----------------------------|----------------------------------|
 * | text     | input[type=text]           | General single-line text         |
 * | email    | input[type=email]          | Validated as email format        |
 * | tel      | input[type=tel]            | Phone number                     |
 * | textarea | textarea                   | Multi-line text                  |
 * | number   | input[type=number]         | Numeric value                    |
 * | select   | select                     | Must have `options`              |
 * | checkbox | input[type=checkbox]       | Boolean (on/off)                 |
 * | file     | input[type=file]           | File upload                      |
 * | hidden   | input[type=hidden]         | Not shown to user                |
 */
export type FormFieldType =
  | "text"
  | "email"
  | "tel"
  | "textarea"
  | "number"
  | "select"
  | "checkbox"
  | "file"
  | "hidden";

/** A single field definition in a form. */
export interface FormField {
  /** Input type — controls HTML element and server-side validation. */
  type: FormFieldType;
  /** Human-readable label rendered next to the input. */
  label: string;
  /** Whether submission fails if this field is absent or empty. */
  required?: boolean;
  /** Placeholder text shown inside the input. */
  placeholder?: string;
  /**
   * Allowed values for `select` fields.
   * Keys are the submitted values; human-readable labels as values.
   */
  options?: Record<string, string>;
  /** Type-specific validation constraints. */
  validate?: FormFieldValidation;
}

export interface FormFieldValidation {
  /**
   * Minimum bound.
   * - `number`: minimum numeric value (inclusive)
   * - `text` / `email` / `tel` / `textarea`: minimum string length
   */
  min?: number;
  /**
   * Maximum bound.
   * - `number`: maximum numeric value (inclusive)
   * - `text` / `email` / `tel` / `textarea`: maximum string length
   */
  max?: number;
  /**
   * Regex pattern the submitted value must match.
   * Applied to string fields only; ignored for other types.
   */
  pattern?: string;
}

/**
 * A form definition — the schema for a single named form.
 * Loaded from `forms/{name}.yaml`.
 */
export interface FormDefinition {
  /** Human-readable form title (used in admin UI and email subjects). */
  title: string;
  /**
   * Whether this form is publicly active. Defaults to `true`.
   *
   * Set to `false` to take a form out of service without deleting the
   * YAML file: GET /api/forms/:name returns 404, POST /api/forms/:name
   * returns 403, and the form does not surface as accepting submissions.
   * Existing submissions remain visible in the admin UI.
   *
   * Refs: claudedocs/security-audit-2026-05.md MED-20.
   */
  enabled?: boolean;
  /**
   * URL to redirect to after a successful form submission.
   * Defaults to "/" if not specified.
   */
  success_url?: string;
  /**
   * Honeypot field name.  Override the global `admin.honeypot` setting
   * for this specific form.  Defaults to "_hp".
   */
  honeypot?: string;
  /**
   * Per-form notification overrides.
   * Falls back to `admin.notifications` from site.yaml when absent.
   */
  notifications?: {
    /** Email address to notify on new submissions. */
    email?: string;
    /** Webhook URL to POST submission JSON to. */
    webhook?: string;
  };
  /** Field definitions keyed by field name. */
  fields: Record<string, FormField>;
}

/** Map of form name → form definition (as loaded from YAML files). */
export type FormMap = Record<string, FormDefinition>;

/** A single field validation error. */
export interface FormValidationError {
  /** Field name. */
  field: string;
  /** Human-readable error message. */
  message: string;
}
