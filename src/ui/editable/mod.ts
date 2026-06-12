/** @jsxImportSource preact */
/**
 * Inline-editing marker components.
 *
 * These are **server-only annotation components** — typed sugar over the
 * `data-dune-*` marker vocabulary that editor plugins (e.g.
 * `@dune/plugin-inline-edit`) consume in the browser. They render their
 * children wrapped in an element carrying the marker attributes, and nothing
 * else: no JavaScript is shipped, no editor is implied, and pages render
 * identically whether or not an editor plugin is installed.
 *
 * The marker vocabulary:
 *
 * | Attribute               | Meaning                                          |
 * |-------------------------|--------------------------------------------------|
 * | `data-dune-body`        | Element wraps the rendered markdown page body    |
 * | `data-dune-field`       | Element shows the named frontmatter field        |
 * | `data-dune-field-type`  | Field type hint for richer editors (date, image…)|
 * | `data-dune-source`      | Content source path the markers belong to        |
 * | `data-dune-no-edit`     | Opt an element out of editor heuristics          |
 *
 * Raw attributes and these components are interchangeable: a template may
 * write `<div data-dune-body>` by hand or render `<EditableMarkdown>` — the
 * output is the same. Attribute values are intentionally restricted to flat
 * strings; richer editor configuration belongs in the editor plugin, not in
 * templates.
 *
 * ## Markers are public
 *
 * Because markers are baked into templates, they ship in the HTML served to
 * **every** visitor — not only to editing admins. In particular,
 * `data-dune-source` exposes the page's content source path (e.g.
 * `content/01.about/default.md`, including ordering prefixes and file
 * naming conventions) to anonymous users and crawlers. Source paths
 * largely mirror public routes, so this is acceptable for most sites — but
 * don't put markers on content whose source location is itself sensitive,
 * and don't encode anything secret in content file names. Editor plugins
 * never rely on markers for access control; all editing endpoints
 * authenticate server-side regardless of what the HTML contains.
 *
 * @example
 * ```tsx
 * import { EditableText, EditableMarkdown } from "@dune/core/ui/editable";
 *
 * <h1><EditableText field="title" sourcePath={page.sourcePath}>{fm.title}</EditableText></h1>
 * <EditableMarkdown sourcePath={page.sourcePath}>
 *   <div dangerouslySetInnerHTML={{ __html: await page.html() }} />
 * </EditableMarkdown>
 * ```
 *
 * @module
 * @since 0.18.0
 */

import { h, type ComponentChildren, type JSX } from "preact";

/** Common props shared by all marker components. */
export interface EditableMarkerProps {
  /** Content source path the marker refers to (`page.sourcePath`). */
  sourcePath: string;
  /** Current value/content — rendered as-is for all visitors. */
  children?: ComponentChildren;
  /** Additional class for the wrapper element. */
  class?: string;
}

/** Props for {@link EditableText} and {@link EditableField}. */
export interface EditableFieldProps extends EditableMarkerProps {
  /** Frontmatter field name the marker refers to. */
  field: string;
  /** Wrapper element tag. @default "span" */
  as?: keyof JSX.IntrinsicElements;
}

/**
 * Marks an inline frontmatter field (plain text editing).
 *
 * Renders `<span data-dune-field={field} data-dune-source={sourcePath}>`.
 */
export function EditableText(props: EditableFieldProps): JSX.Element {
  const { field, sourcePath, children, as = "span", class: cls } = props;
  return h(as, {
    "data-dune-field": field,
    "data-dune-source": sourcePath,
    class: cls,
  }, children);
}

/**
 * Marks the element that wraps the rendered markdown page body.
 *
 * Renders `<div data-dune-body data-dune-source={sourcePath}>`. Use on
 * exactly the element containing the page's rendered markdown — never on
 * listing or landing layouts that render template-generated content.
 */
export function EditableMarkdown(props: EditableMarkerProps): JSX.Element {
  const { sourcePath, children, class: cls } = props;
  return h("div", {
    "data-dune-body": "",
    "data-dune-source": sourcePath,
    class: cls,
  }, children);
}

/** Props for typed field markers. */
export interface TypedFieldProps extends EditableFieldProps {
  /** Field type hint consumed by editor plugins (e.g. `"date"`, `"image"`). */
  type: string;
}

/**
 * Marks a frontmatter field with an explicit type hint, letting editor
 * plugins mount a type-appropriate editor (date picker, media picker,
 * custom registered editors).
 */
export function EditableField(props: TypedFieldProps): JSX.Element {
  const { field, type, sourcePath, children, as = "span", class: cls } = props;
  return h(as, {
    "data-dune-field": field,
    "data-dune-field-type": type,
    "data-dune-source": sourcePath,
    class: cls,
  }, children);
}

/** {@link EditableField} preset for date frontmatter fields. */
export function EditableDate(props: EditableFieldProps): JSX.Element {
  return EditableField({ ...props, type: "date" });
}

/** {@link EditableField} preset for image frontmatter fields. */
export function EditableImage(props: EditableFieldProps): JSX.Element {
  return EditableField({ ...props, type: "image" });
}
