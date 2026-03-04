/**
 * Flex Objects — type definitions for custom content types.
 *
 * A Flex Object is a schema-driven custom data type beyond pages
 * (e.g. products, team members, events, FAQs).
 *
 * Schema definition lives at: `flex-objects/{type}.yaml`
 * Records live at:            `flex-objects/{type}/{id}.yaml`
 */

import type { BlueprintField } from "../blueprints/types.ts";

// Re-export for convenience so callers don't need two imports.
export type { BlueprintField };

/**
 * A Flex Object schema — analogous to a Blueprint but for custom data types
 * (not tied to page templates).
 *
 * @example flex-objects/products.yaml
 * ```yaml
 * title: Products
 * icon: 🛍️
 * description: Product catalogue entries
 * fields:
 *   name:
 *     type: text
 *     label: Product Name
 *     required: true
 *   price:
 *     type: number
 *     label: Price (CHF)
 *   published:
 *     type: toggle
 *     label: Published
 *     default: true
 * ```
 */
export interface FlexSchema {
  /** Human-readable type label shown in the admin panel. */
  title: string;
  /** Optional emoji or short string used as icon in the sidebar. */
  icon?: string;
  /** Optional description shown on the type list page. */
  description?: string;
  /**
   * Field definitions.  Keys are field names (stored in the YAML record).
   * Reuses BlueprintField definitions — same types, validation, and options.
   */
  fields: Record<string, BlueprintField>;
}

/** Map of type name → schema (as loaded from disk, before any resolution). */
export type FlexSchemaMap = Record<string, FlexSchema>;

/**
 * A single Flex Object record.
 *
 * Stored on disk as a YAML file.  The `_type` field is derived from the
 * directory name (not written to the file) and is injected in memory.
 */
export interface FlexRecord {
  /** Unique record identifier (UUID). */
  _id: string;
  /** Type name — corresponds to the schema key (injected, not stored). */
  _type: string;
  /** Creation timestamp (epoch milliseconds). */
  _createdAt: number;
  /** Last-updated timestamp (epoch milliseconds). */
  _updatedAt: number;
  /** User-defined field values. */
  [key: string]: unknown;
}

/**
 * Validation error for a Flex Object record field.
 */
export interface FlexValidationError {
  /** Field name. */
  field: string;
  /** Human-readable error message. */
  message: string;
}
