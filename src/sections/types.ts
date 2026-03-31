/**
 * Visual Page Builder — type definitions for section schemas and instances.
 */

/** Supported field types for section fields */
export type SectionFieldType =
  | "text"
  | "textarea"
  | "richtext"
  | "image"
  | "url"
  | "number"
  | "toggle"
  | "color"
  | "select"
  | "list";

/** A field definition within a section schema */
export interface SectionField {
  id: string;
  type: SectionFieldType;
  label: string;
  placeholder?: string;
  default?: unknown;
  required?: boolean;
  /** For `select` fields: available options */
  options?: Array<{ value: string; label: string }>;
  /** For `list` fields: schema of each list item */
  itemFields?: SectionField[];
}

/** Schema definition for a section type */
export interface SectionDef {
  /** Unique type identifier, e.g. "hero" */
  type: string;
  /** Human-readable label, e.g. "Hero Section" */
  label: string;
  /** Emoji or short string shown in the section palette */
  icon: string;
  /** One-line description shown in the palette */
  description: string;
  /** Ordered list of editable fields */
  fields: SectionField[];
}

/** A section instance stored in page frontmatter under `sections:` */
export interface SectionInstance {
  /** Unique ID generated when the section is added */
  id: string;
  /** Must match a registered SectionDef.type */
  type: string;
  /** Field values keyed by SectionField.id */
  [field: string]: unknown;
}
