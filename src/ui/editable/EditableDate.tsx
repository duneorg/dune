/** @jsxImportSource preact */
/**
 * `<EditableDate>` — date picker for date-typed frontmatter fields.
 *
 * Renders its children in production.  In admin edit mode an `<input type="date">`
 * popover appears on click; the selected value is patched via the fields API.
 *
 * @example
 * ```tsx
 * <EditableDate field="date" sourcePath={page.sourcePath}>
 *   <time dateTime={page.frontmatter.date}>{page.frontmatter.date}</time>
 * </EditableDate>
 * ```
 */

import { h, type ComponentChildren } from "preact";
import type { JSX } from "preact";
import { useState, useCallback, useRef } from "preact/hooks";
import { isEditMode } from "./context.ts";

/** Props for {@link EditableDate}. */
export interface EditableDateProps {
  /** The frontmatter field key, e.g. `"date"`. */
  field: string;
  /** Source path of the content file. */
  sourcePath: string;
  /**
   * Current ISO date value, e.g. `"2026-06-08"`.
   * Used to pre-populate the date picker.
   */
  value?: string;
  /** The wrapped element — rendered verbatim in production. */
  children: ComponentChildren;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

export default function EditableDate({
  field,
  sourcePath,
  value,
  children,
}: EditableDateProps): JSX.Element {
  if (!isEditMode()) {
    return h("span", { "data-dune-field": field, "data-dune-source": sourcePath }, children);
  }
  return h(EditableDateActive, { field, sourcePath, value, children });
}

function EditableDateActive({ field, sourcePath, value, children }: EditableDateProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const inputRef = useRef<HTMLInputElement>(null);

  const save = useCallback(async (dateValue: string) => {
    setStatus("saving");
    try {
      const encodedPath = encodeURIComponent(sourcePath);
      const res = await fetch(`/admin/api/content/${encodedPath}/fields`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ fields: { [field]: dateValue } }),
      });
      setStatus(res.ok ? "saved" : "error");
      if (res.ok) setTimeout(() => { setStatus("idle"); setOpen(false); }, 1000);
    } catch {
      setStatus("error");
    }
  }, [field, sourcePath]);

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
        onClick: () => { setOpen((v) => !v); },
        style: { cursor: "pointer", borderBottom: "1px dashed #3498db" },
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
          border: "1px solid #3498db",
          borderRadius: "4px",
          padding: "8px",
          boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          display: "flex",
          flexDirection: "column",
          gap: "6px",
        },
      },
      h("input", {
        ref: inputRef,
        type: "date",
        defaultValue: value ?? "",
        style: { fontSize: "14px", padding: "2px 4px" },
      }),
      h(
        "button",
        {
          onClick: () => {
            const v = inputRef.current?.value;
            if (v) save(v);
          },
          disabled: status === "saving",
          style: {
            cursor: "pointer",
            background: "#3498db",
            color: "#fff",
            border: "none",
            borderRadius: "3px",
            padding: "3px 10px",
            fontSize: "12px",
          },
        },
        status === "saving" ? "Saving…" : "Save",
      ),
      status === "error" && h(
        "span",
        { style: { color: "#e74c3c", fontSize: "11px" } },
        "Save failed",
      ),
    ),
  );
}
