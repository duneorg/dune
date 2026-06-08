/** @jsxImportSource preact */
/**
 * `<EditableField>` — generic frontmatter field editor with registry lookup.
 *
 * This is the base component for custom and blueprint-typed fields.
 * It resolves the editor in priority order:
 *   1. `renderEditor` render prop (explicit template override — always wins)
 *   2. Registry lookup by `fieldType` (registered via `registerFieldEditor()`)
 *   3. Built-in fallback by primitive type: text, date, image, toggle, select
 *
 * @example
 * ```tsx
 * // Explicit render prop (one-off custom field):
 * <EditableField field="accent_color" fieldType="color" sourcePath={page.sourcePath}>
 *   <span style={{ background: page.frontmatter.accent_color }} />
 * </EditableField>
 *
 * // Uses registry if "color" was registered via registerFieldEditor:
 * <EditableField field="accent_color" fieldType="color" sourcePath={page.sourcePath}>
 *   <span style={{ background: page.frontmatter.accent_color }} />
 * </EditableField>
 * ```
 */

import { h, type ComponentChildren } from "preact";
import type { JSX } from "preact";
import { useState, useCallback, useRef } from "preact/hooks";
import { isEditMode } from "./context.ts";
import { getFieldEditor, type FieldEditorComponent, type FieldEditorProps } from "./registry.ts";

/** Props for {@link EditableField}. */
export interface EditableFieldProps {
  /** The frontmatter field key. */
  field: string;
  /** Blueprint field type string, e.g. `"text"`, `"color"`, `"star_rating"`. */
  fieldType?: string;
  /** Current field value — passed to the editor component. */
  value?: unknown;
  /** Source path of the content file. */
  sourcePath: string;
  /** The wrapped display element — rendered verbatim in production. */
  children: ComponentChildren;
  /**
   * Explicit render prop for the editor UI.
   * Receives `{ value, onChange, fieldType, fieldName, saving }`.
   * When provided, skips registry and built-in fallback lookup.
   */
  renderEditor?: (props: FieldEditorProps) => JSX.Element;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

export default function EditableField({
  field,
  fieldType = "text",
  value,
  sourcePath,
  children,
  renderEditor,
}: EditableFieldProps): JSX.Element {
  if (!isEditMode()) {
    return h("span", { "data-dune-field": field, "data-dune-source": sourcePath }, children);
  }
  return h(EditableFieldActive, {
    field, fieldType, value, sourcePath, children, renderEditor,
  });
}

function EditableFieldActive({
  field,
  fieldType = "text",
  value,
  sourcePath,
  children,
  renderEditor,
}: EditableFieldProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [localValue, setLocalValue] = useState<unknown>(value);
  const [status, setStatus] = useState<SaveStatus>("idle");

  const save = useCallback(async (newValue: unknown) => {
    setStatus("saving");
    try {
      const encodedPath = encodeURIComponent(sourcePath);
      const res = await fetch(`/admin/api/content/${encodedPath}/fields`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ fields: { [field]: newValue } }),
      });
      setStatus(res.ok ? "saved" : "error");
      if (res.ok) {
        setLocalValue(newValue);
        setTimeout(() => { setStatus("idle"); setOpen(false); }, 1200);
      }
    } catch {
      setStatus("error");
    }
  }, [field, sourcePath]);

  const onChange = useCallback((v: unknown) => setLocalValue(v), []);

  // ── Resolve editor component ─────────────────────────────────────────────────

  let EditorComponent: FieldEditorComponent | undefined;
  if (!renderEditor) {
    EditorComponent = getFieldEditor(fieldType) ?? getBuiltinFallback(fieldType);
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return h(
    "span",
    {
      style: { position: "relative", display: "inline-block" },
      "data-dune-field": field,
      "data-dune-source": sourcePath,
    },
    h(
      "span",
      {
        onClick: () => setOpen((v) => !v),
        style: { cursor: "pointer", borderBottom: "1px dashed #9b59b6" },
        title: `Edit ${field}`,
      },
      children,
    ),
    open && h(
      "span",
      {
        style: {
          position: "absolute",
          top: "calc(100% + 4px)",
          left: 0,
          zIndex: 9999,
          background: "#fff",
          border: "1px solid #9b59b6",
          borderRadius: "4px",
          padding: "8px",
          boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          minWidth: "200px",
        },
      },
      // Render prop takes priority
      renderEditor
        ? renderEditor({ value: localValue, onChange, fieldType, fieldName: field, saving: status === "saving" })
        : EditorComponent
          ? h(EditorComponent, { value: localValue, onChange, fieldType, fieldName: field, saving: status === "saving" })
          : h(BuiltinTextFallback, { value: localValue, onChange }),
      h(
        "span",
        { style: { display: "flex", gap: "6px", marginTop: "6px" } },
        h(
          "button",
          {
            onClick: () => save(localValue),
            disabled: status === "saving",
            style: {
              cursor: "pointer",
              background: "#9b59b6",
              color: "#fff",
              border: "none",
              borderRadius: "3px",
              padding: "3px 10px",
              fontSize: "12px",
            },
          },
          status === "saving" ? "Saving…" : "Save",
        ),
        h(
          "button",
          {
            onClick: () => setOpen(false),
            style: {
              cursor: "pointer",
              background: "#eee",
              border: "none",
              borderRadius: "3px",
              padding: "3px 8px",
              fontSize: "12px",
            },
          },
          "Cancel",
        ),
      ),
      status === "error" && h("span", { style: { color: "#e74c3c", fontSize: "11px", display: "block", marginTop: "4px" } }, "Save failed"),
      status === "saved" && h("span", { style: { color: "#2ecc71", fontSize: "11px", display: "block", marginTop: "4px" } }, "Saved ✓"),
    ),
  );
}

// ── Fallback editor components ────────────────────────────────────────────────

function getBuiltinFallback(fieldType: string): FieldEditorComponent | undefined {
  // Returns a simple text input for all unrecognised types.
  // Built-in types like "date", "image", "toggle" should use their
  // dedicated <EditableDate>, <EditableImage> components directly in the
  // template; this fallback covers unknown custom types.
  return undefined;  // BuiltinTextFallback used inline above
}

function BuiltinTextFallback({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (v: unknown) => void;
}): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  return h("input", {
    ref: inputRef,
    type: "text",
    defaultValue: String(value ?? ""),
    onInput: () => onChange(inputRef.current?.value ?? ""),
    style: { width: "100%", fontSize: "14px", padding: "4px 6px", border: "1px solid #ccc", borderRadius: "3px" },
  });
}
