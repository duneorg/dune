/** @jsxImportSource preact */
/**
 * `<EditableText>` — inline contenteditable editor for a single frontmatter
 * field (string values).
 *
 * Renders its children verbatim in production.  In admin edit mode it wraps
 * the child element with a contenteditable overlay that activates on
 * double-click, debounces saves to the frontmatter fields API, and shows a
 * save-status indicator.
 *
 * @example
 * ```tsx
 * <EditableText field="title" sourcePath={page.sourcePath}>
 *   <h1>{page.frontmatter.title}</h1>
 * </EditableText>
 * ```
 */

import { h, type ComponentChildren, type VNode } from "preact";
import type { JSX } from "preact";
import { useState, useEffect, useRef, useCallback } from "preact/hooks";
import { isEditMode } from "./context.ts";

/** Props for {@link EditableText}. */
export interface EditableTextProps {
  /** The frontmatter field key, e.g. `"title"`. */
  field: string;
  /** Source path of the content file, e.g. `"pages/about/default.md"`. */
  sourcePath: string;
  /** The wrapped element — rendered verbatim in production. */
  children: ComponentChildren;
  /** Additional class name applied to the edit wrapper in edit mode. */
  className?: string;
}

/** Debounce delay for saves (ms). */
const SAVE_DEBOUNCE_MS = 600;

type SaveStatus = "idle" | "saving" | "saved" | "error";

export default function EditableText({
  field,
  sourcePath,
  children,
  className,
}: EditableTextProps): JSX.Element {
  // SSR / production: render children as-is.
  if (!isEditMode()) {
    return h("span", { "data-dune-field": field, "data-dune-source": sourcePath }, children);
  }

  return h(EditableTextActive, { field, sourcePath, children, className });
}

/** Client-side activated component (only rendered when edit mode is on). */
function EditableTextActive({
  field,
  sourcePath,
  children,
}: EditableTextProps): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const wrapperRef = useRef<HTMLSpanElement>(null);

  const save = useCallback(async (value: string) => {
    setStatus("saving");
    try {
      const encodedPath = encodeURIComponent(sourcePath);
      const res = await fetch(`/admin/api/content/${encodedPath}/fields`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ fields: { [field]: value } }),
      });
      setStatus(res.ok ? "saved" : "error");
      if (res.ok) setTimeout(() => setStatus("idle"), 1500);
    } catch {
      setStatus("error");
    }
  }, [field, sourcePath]);

  const scheduleSave = useCallback((value: string) => {
    if (saveTimer.current !== undefined) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => save(value), SAVE_DEBOUNCE_MS);
  }, [save]);

  useEffect(() => () => {
    if (saveTimer.current !== undefined) clearTimeout(saveTimer.current);
  }, []);

  const handleInput = useCallback((e: Event) => {
    const text = (e.target as HTMLElement).textContent ?? "";
    scheduleSave(text);
  }, [scheduleSave]);

  return h(
    "span",
    {
      ref: wrapperRef,
      class: `dune-editable-text${editing ? " dune-editable-text--active" : ""}`,
      "data-dune-field": field,
      "data-dune-source": sourcePath,
      style: { position: "relative", display: "inline-block" },
    },
    h(
      "span",
      {
        contentEditable: editing,
        suppressContentEditableWarning: true,
        onDblClick: () => setEditing(true),
        onBlur: () => setEditing(false),
        onInput: editing ? handleInput : undefined,
        style: {
          outline: editing ? "2px solid #3498db" : undefined,
          borderRadius: editing ? "2px" : undefined,
          padding: editing ? "0 2px" : undefined,
          cursor: editing ? "text" : "default",
        },
      },
      children,
    ),
    !editing && h(
      "button",
      {
        class: "dune-edit-handle",
        title: `Edit ${field}`,
        onClick: (e: MouseEvent) => { e.preventDefault(); setEditing(true); },
        style: {
          position: "absolute",
          top: "-8px",
          right: "-8px",
          background: "#3498db",
          color: "#fff",
          border: "none",
          borderRadius: "3px",
          padding: "1px 5px",
          fontSize: "10px",
          cursor: "pointer",
          opacity: 0,
          transition: "opacity 0.15s",
        },
      },
      "✎",
    ),
    status !== "idle" && h(
      "span",
      {
        class: `dune-save-status dune-save-status--${status}`,
        style: {
          position: "absolute",
          bottom: "-18px",
          right: 0,
          fontSize: "10px",
          background: status === "error" ? "#e74c3c" : "#2ecc71",
          color: "#fff",
          borderRadius: "2px",
          padding: "1px 4px",
          pointerEvents: "none",
        },
      },
      status === "saving" ? "saving…" : status === "saved" ? "saved" : "error",
    ),
  );
}
