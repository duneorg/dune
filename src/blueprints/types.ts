/**
 * Blueprint type definitions.
 *
 * Blueprints define per-template frontmatter schemas — typed content models
 * similar to Contentlayer/Keystatic/Astro Content Collections.
 *
 * A blueprint lives at `blueprints/{template}.yaml` in the project root and
 * describes the expected fields for every page using that template.
 *
 * @example blueprints/post.yaml
 * ```yaml
 * title: Blog Post
 * extends: default          # inherit fields from blueprints/default.yaml
 * fields:
 *   date:
 *     type: date
 *     label: Publication Date
 *     required: true
 *   author:
 *     type: text
 *     label: Author
 *     required: true
 *   featured:
 *     type: toggle
 *     label: Featured Post
 *     default: false
 * ```
 */

// === Field types ===

/**
 * Supported field types — maps to PageFrontmatter value types.
 *
 * | type      | JS type                         | Validation extras                |
 * |-----------|----------------------------------|----------------------------------|
 * | text      | string                           | min/max length, pattern          |
 * | textarea  | string                           | min/max length                   |
 * | markdown  | string                           | min/max length                   |
 * | number    | number                           | min/max value                    |
 * | toggle    | boolean                          | —                                |
 * | date      | string (YYYY-MM-DD)              | min/max as date strings          |
 * | select    | string (one of options keys)     | options must be provided         |
 * | list      | string[]                         | min/max item count               |
 * | file      | string (path or URL)             | pattern for allowed extensions   |
 * | color     | string (#rrggbb or CSS value)    | pattern                          |
 */
export type BlueprintFieldType =
  | "text"
  | "textarea"
  | "markdown"
  | "number"
  | "toggle"
  | "date"
  | "select"
  | "list"
  | "file"
  | "color";

/** A single field definition in a blueprint. */
export interface BlueprintField {
  /** Field type — controls type checking and admin UI widget. */
  type: BlueprintFieldType;
  /** Human-readable label (used in admin UI). */
  label: string;
  /** Default value to use when the field is absent. */
  default?: unknown;
  /** Whether the field must be present and non-empty. */
  required?: boolean;
  /**
   * Allowed option values for `select` fields.
   * Keys are values stored in frontmatter; values are human-readable labels.
   * @example { "draft": "Draft", "published": "Published" }
   */
  options?: Record<string, string>;
  /** Extra type-specific validation constraints. */
  validate?: BlueprintFieldValidation;
  /**
   * File upload configuration — only meaningful when `type` is `"file"`.
   * Allows per-field control over size limits, MIME type allowlist,
   * and storage sub-path for blueprint-driven upload fields.
   */
  upload?: BlueprintFileUploadConfig;
}

/**
 * Per-field file upload configuration for blueprint fields of type `"file"`.
 * These settings are enforced server-side; the client's declared MIME type
 * and filename are never trusted.
 *
 * @example
 * ```yaml
 * fields:
 *   avatar:
 *     type: file
 *     label: Profile Photo
 *     required: true
 *     upload:
 *       max_size_mb: 2
 *       allowed_types: ["image/jpeg", "image/png", "image/webp"]
 *       storage: "user-uploads/avatars"
 *       public_url: true
 * ```
 */
export interface BlueprintFileUploadConfig {
  /**
   * Maximum allowed file size in megabytes.
   * Files exceeding this limit are rejected with HTTP 413.
   * Default: 5
   */
  max_size_mb?: number;
  /**
   * Permitted MIME types.
   * The server derives the actual MIME type from the file extension (not the
   * client-supplied Content-Type) using the same allowlist as the global
   * upload security module.
   *
   * Specify as an array of MIME type strings.
   * @example ["image/jpeg", "image/png", "image/webp"]
   */
  allowed_types?: string[];
  /**
   * Sub-path within the uploads directory where files are stored.
   * Must not contain path traversal sequences.
   * @example "user-uploads/avatars"
   */
  storage?: string;
  /**
   * Whether to include the public URL in the upload response.
   * Default: true
   */
  public_url?: boolean;
}

export interface BlueprintFieldValidation {
  /**
   * Minimum bound.
   * - `number`: minimum value (inclusive)
   * - `text` / `textarea` / `markdown` / `file` / `color`: minimum string length
   * - `list`: minimum item count
   */
  min?: number;
  /**
   * Maximum bound.
   * - `number`: maximum value (inclusive)
   * - `text` / `textarea` / `markdown` / `file` / `color`: maximum string length
   * - `list`: maximum item count
   */
  max?: number;
  /**
   * Regex pattern the value must match.
   * - `text` / `textarea` / `markdown` / `file` / `color`: tested against the string
   * - `list`: tested against each item
   * - Other types: ignored
   */
  pattern?: string;
}

// === Blueprint ===

/**
 * A blueprint definition — the schema for a template's frontmatter.
 * Loaded from `blueprints/{template}.yaml`.
 */
export interface BlueprintDefinition {
  /** Human-readable name for this content type (e.g. "Blog Post"). */
  title: string;
  /**
   * Parent blueprint to inherit fields from.
   * Must match another blueprint filename (without .yaml extension).
   * @example "default"
   */
  extends?: string;
  /**
   * Field definitions.  Keys are frontmatter field names.
   * @example { date: { type: "date", required: true } }
   */
  fields: Record<string, BlueprintField>;
}

/**
 * Resolved blueprint — inheritance fully flattened.
 * `fields` is the merged union of all inherited + own fields.
 */
export interface ResolvedBlueprint {
  title: string;
  /** Template name this blueprint applies to. */
  template: string;
  /** Fully merged fields (inherited overrides → own fields). */
  fields: Record<string, BlueprintField>;
}

/** Map of template name → blueprint definition (as loaded, before resolution). */
export type BlueprintMap = Record<string, BlueprintDefinition>;

// === Validation ===

/** A single validation error from validating frontmatter against a blueprint. */
export interface BlueprintValidationError {
  /** Frontmatter field name. */
  field: string;
  /** Human-readable error message. */
  message: string;
}
