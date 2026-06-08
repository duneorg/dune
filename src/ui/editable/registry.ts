/**
 * Field editor registry.
 *
 * Maps blueprint field type strings to inline editor components.  Used by
 * `<EditableField>` to resolve the right editor when no explicit `renderEditor`
 * render prop is provided, and by the auto-overlay engine to pick editors for
 * blueprint-typed fields on standard `.md` pages.
 *
 * Registration precedence in `<EditableField>`:
 *   1. Explicit `renderEditor` render prop (template author always wins)
 *   2. Registry lookup by blueprint field type string
 *   3. Built-in fallback by primitive type (text, date, image, toggle, select)
 *
 * Built-in types are pre-registered at module load time.  Themes call
 * `registerFieldEditor()` once (typically in `dune.config.ts` or their
 * `registerEditors()` helper) to extend the registry.
 *
 * @example
 * ```ts
 * import { registerFieldEditor } from "@dune/core/ui/editable";
 * registerFieldEditor("color", ColorPickerIsland);
 * registerFieldEditor("star_rating", StarRatingIsland);
 * ```
 */

import type { ComponentType } from "preact";

/** Props passed to every field editor component in the registry. */
export interface FieldEditorProps {
  /** Current field value. */
  value: unknown;
  /** Called when the user commits a new value. */
  onChange: (value: unknown) => void;
  /** The blueprint field type string (e.g. "text", "color", "star_rating"). */
  fieldType: string;
  /** The field name / key in frontmatter. */
  fieldName: string;
  /** Whether the editor is in a loading/saving state. */
  saving?: boolean;
}

/** A field editor component constructor. */
export type FieldEditorComponent = ComponentType<FieldEditorProps>;

// ── Internal registry ─────────────────────────────────────────────────────────

const _registry = new Map<string, FieldEditorComponent>();

/**
 * Register a custom field editor for a blueprint field type.
 *
 * @param fieldType - The blueprint field type string, e.g. `"color"`.
 * @param component - A Preact component that receives {@link FieldEditorProps}.
 */
export function registerFieldEditor(
  fieldType: string,
  component: FieldEditorComponent,
): void {
  _registry.set(fieldType, component);
}

/**
 * Look up the registered editor for a field type.
 * Returns `undefined` if no custom editor has been registered for this type.
 */
export function getFieldEditor(
  fieldType: string,
): FieldEditorComponent | undefined {
  return _registry.get(fieldType);
}

/**
 * Return all currently registered field type keys.
 * Primarily for debugging and documentation.
 */
export function listRegisteredFieldTypes(): string[] {
  return [..._registry.keys()];
}
