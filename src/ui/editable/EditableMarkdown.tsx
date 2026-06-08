/** @jsxImportSource preact */
/**
 * `<EditableMarkdown>` — full WYSIWYG editor for the page Markdown body.
 *
 * In production renders its children verbatim (the pre-rendered HTML).
 * In admin edit mode it connects to the Y.js WebSocket endpoint and activates
 * a TipTap WYSIWYG editor over the content area when the user clicks "Edit".
 *
 * TipTap + Y.js collaboration + tiptap-markdown are loaded lazily via dynamic
 * import so they don't affect the page bundle for non-admin visitors.
 *
 * The editor serialises back to Markdown on commit (via tiptap-markdown).
 * Explicit "Save" calls `POST /admin/api/content/:path/commit`.
 *
 * @example
 * ```tsx
 * <EditableMarkdown sourcePath={page.sourcePath}>
 *   <div dangerouslySetInnerHTML={{ __html: await page.html() }} />
 * </EditableMarkdown>
 * ```
 */

import { h, type ComponentChildren } from "preact";
import type { JSX } from "preact";
import { useState, useEffect, useRef, useCallback } from "preact/hooks";
import { isEditMode, getEditWsUrl } from "./context.ts";

/** Props for {@link EditableMarkdown}. */
export interface EditableMarkdownProps {
  /** Source path of the content file, e.g. `"pages/about/default.md"`. */
  sourcePath: string;
  /** The pre-rendered HTML content — shown in read mode and replaced by TipTap in edit mode. */
  children: ComponentChildren;
  /** Additional class name applied in edit mode. */
  className?: string;
  /**
   * When `"source"`, activates a plain CodeMirror source editor instead of
   * TipTap WYSIWYG.  Useful for pages with complex Markdown the author
   * wants to control exactly.
   * @default "wysiwyg"
   */
  mode?: "wysiwyg" | "source";
}

type EditState = "read" | "loading" | "editing" | "saving" | "error";

export default function EditableMarkdown({
  sourcePath,
  children,
  className,
  mode = "wysiwyg",
}: EditableMarkdownProps): JSX.Element {
  if (!isEditMode()) {
    return h(
      "div",
      { "data-dune-source": sourcePath, "data-dune-editable": "body" },
      children,
    );
  }

  return h(EditableMarkdownActive, { sourcePath, children, className, mode });
}

function EditableMarkdownActive({
  sourcePath,
  children,
  className,
  mode,
}: EditableMarkdownProps): JSX.Element {
  const [editState, setEditState] = useState<EditState>("read");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const editorRef = useRef<HTMLDivElement>(null);
  // deno-lint-ignore no-explicit-any
  const editorInstanceRef = useRef<any>(null);
  // deno-lint-ignore no-explicit-any
  const providerRef = useRef<any>(null);

  const startEditing = useCallback(async () => {
    if (editState !== "read") return;
    setEditState("loading");

    try {
      if (mode === "source") {
        // Source mode: just make the container a plain textarea — lightweight.
        setEditState("editing");
        return;
      }

      // WYSIWYG mode: lazy-load TipTap + Y.js collaboration.
      const [
        { Editor },
        { StarterKit },
        { Collaboration },
        { CollaborationCursor },
        { Markdown },
        Y,
        { WebsocketProvider },
      ] = await Promise.all([
        import("npm:@tiptap/core@^2"),
        import("npm:@tiptap/starter-kit@^2"),
        import("npm:@tiptap/extension-collaboration@^2"),
        import("npm:@tiptap/extension-collaboration-cursor@^2"),
        import("npm:tiptap-markdown@^0"),
        import("npm:yjs@^13"),
        import("npm:y-websocket@^2"),
      ]);

      if (!editorRef.current) {
        setEditState("read");
        return;
      }

      // deno-lint-ignore no-explicit-any
      const ydoc = new (Y as any).Doc();
      const wsUrl = getEditWsUrl(sourcePath);
      const provider = new WebsocketProvider(wsUrl, sourcePath, ydoc);
      providerRef.current = provider;

      const editor = new Editor({
        element: editorRef.current,
        extensions: [
          StarterKit.configure({ history: false }),
          Collaboration.configure({ document: ydoc }),
          CollaborationCursor.configure({
            provider,
            user: {
              name: (window as unknown as { __DUNE_USER_NAME__?: string }).__DUNE_USER_NAME__ ?? "Editor",
              color: "#3498db",
            },
          }),
          // deno-lint-ignore no-explicit-any
          (Markdown as any).configure({ html: false, transformPastedText: true }),
        ],
      });

      editorInstanceRef.current = editor;
      setEditState("editing");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to load editor");
      setEditState("error");
    }
  }, [editState, sourcePath, mode]);

  const stopEditing = useCallback(() => {
    editorInstanceRef.current?.destroy();
    editorInstanceRef.current = null;
    providerRef.current?.destroy();
    providerRef.current = null;
    setEditState("read");
  }, []);

  const commit = useCallback(async () => {
    setEditState("saving");
    try {
      const encodedPath = encodeURIComponent(sourcePath);
      const res = await fetch(`/admin/api/content/${encodedPath}/commit`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(`Save failed: ${res.status}`);
      setEditState("editing");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Save failed");
      setEditState("error");
    }
  }, [sourcePath]);

  // Clean up on unmount.
  useEffect(() => () => {
    editorInstanceRef.current?.destroy();
    providerRef.current?.destroy();
  }, []);

  const isActive = editState === "editing" || editState === "saving" || editState === "loading";

  return h(
    "div",
    {
      class: `dune-editable-markdown${isActive ? " dune-editable-markdown--active" : ""}${className ? ` ${className}` : ""}`,
      "data-dune-source": sourcePath,
      "data-dune-editable": "body",
      style: { position: "relative" },
    },

    // Toolbar (only in active edit states)
    isActive && h(
      "div",
      {
        class: "dune-markdown-toolbar",
        style: {
          display: "flex",
          gap: "8px",
          marginBottom: "8px",
          padding: "4px 8px",
          background: "#f4f6f8",
          borderRadius: "4px",
          fontSize: "13px",
        },
      },
      h(
        "button",
        { onClick: commit, disabled: editState === "saving", style: { cursor: "pointer" } },
        editState === "saving" ? "Saving…" : "Save",
      ),
      h(
        "button",
        { onClick: stopEditing, style: { cursor: "pointer" } },
        "Cancel",
      ),
    ),

    // Editor container (shown in edit mode; TipTap mounts here)
    isActive && h(
      "div",
      {
        ref: editorRef,
        class: "dune-tiptap-editor",
        style: {
          minHeight: "200px",
          padding: "12px",
          border: "1px solid #3498db",
          borderRadius: "4px",
          outline: "none",
          background: "#fff",
        },
      },
    ),

    // Read mode: rendered children + edit button overlay
    !isActive && h(
      "div",
      { style: { position: "relative" } },
      children,
      h(
        "button",
        {
          class: "dune-edit-handle dune-edit-handle--body",
          title: "Edit content",
          onClick: startEditing,
          style: {
            position: "absolute",
            top: "8px",
            right: "8px",
            background: "#3498db",
            color: "#fff",
            border: "none",
            borderRadius: "4px",
            padding: "4px 10px",
            fontSize: "12px",
            cursor: "pointer",
            opacity: 0,
            transition: "opacity 0.15s",
          },
        },
        editState === "error" ? `Error: ${errorMsg}` : "✎ Edit",
      ),
    ),
  );
}
