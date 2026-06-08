/**
 * @dune/core/ui/editable — Inline editing component kit (v0.16+).
 *
 * Preact island components that make page content editable when an admin
 * session is active.  All components render their children verbatim in
 * production (no extra DOM, zero JS overhead for anonymous visitors).
 *
 * **Components:**
 * - {@link EditableText} — inline contenteditable for string frontmatter fields
 * - {@link EditableMarkdown} — TipTap WYSIWYG for the page Markdown body (Y.js backed)
 * - {@link EditableImage} — media picker for image frontmatter fields
 * - {@link EditableDate} — date picker for date fields
 * - {@link EditableField} — generic field editor with registry lookup
 * - {@link AdminBar} — persistent admin toolbar injected at the page top
 *
 * **Field editor registry:**
 * ```ts
 * import { registerFieldEditor } from "@dune/core/ui/editable";
 * registerFieldEditor("color", ColorPickerIsland);
 * registerFieldEditor("star_rating", StarRatingIsland);
 * ```
 *
 * @module
 * @since 0.16.0
 */

export { default as EditableText } from "./EditableText.tsx";
export type { EditableTextProps } from "./EditableText.tsx";

export { default as EditableMarkdown } from "./EditableMarkdown.tsx";
export type { EditableMarkdownProps } from "./EditableMarkdown.tsx";

export { default as EditableImage } from "./EditableImage.tsx";
export type { EditableImageProps } from "./EditableImage.tsx";

export { default as EditableDate } from "./EditableDate.tsx";
export type { EditableDateProps } from "./EditableDate.tsx";

export { default as EditableField } from "./EditableField.tsx";
export type { EditableFieldProps } from "./EditableField.tsx";

export { default as AdminBar } from "./AdminBar.tsx";
export type { AdminBarProps } from "./AdminBar.tsx";

export {
  registerFieldEditor,
  getFieldEditor,
  listRegisteredFieldTypes,
} from "./registry.ts";
export type { FieldEditorProps, FieldEditorComponent } from "./registry.ts";

export { isEditMode, getEditSourcePath, getEditWsUrl } from "./context.ts";
