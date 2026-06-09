/** @jsxImportSource preact */
/**
 * `<EditableImage>` — media picker for image frontmatter fields.
 *
 * In production renders its children verbatim.  In admin edit mode an edit
 * handle appears over the image; clicking it opens the existing admin media
 * browser in a modal.  On selection the image field is patched via the
 * frontmatter fields API.
 *
 * @example
 * ```tsx
 * <EditableImage field="hero_image" sourcePath={page.sourcePath}>
 *   <img src={page.frontmatter.hero_image} alt="" />
 * </EditableImage>
 * ```
 */

import { h, type ComponentChildren } from "preact";
import type { JSX } from "preact";
import { useState, useCallback } from "preact/hooks";
import { isEditMode } from "./context.ts";

/** Props for {@link EditableImage}. */
export interface EditableImageProps {
  /** The frontmatter field key for the image URL, e.g. `"hero_image"`. */
  field: string;
  /** Source path of the content file. */
  sourcePath: string;
  /** The wrapped image element — rendered verbatim in production. */
  children: ComponentChildren;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

export default function EditableImage({
  field,
  sourcePath,
  children,
}: EditableImageProps): JSX.Element {
  if (!isEditMode()) {
    return h("span", { "data-dune-field": field, "data-dune-source": sourcePath }, children);
  }
  return h(EditableImageActive, { field, sourcePath, children });
}

function EditableImageActive({ field, sourcePath, children }: EditableImageProps): JSX.Element {
  const [status, setStatus] = useState<SaveStatus>("idle");

  const openPicker = useCallback(() => {
    // Open the admin media browser in a popup.  The browser posts a
    // "dune:media-selected" message with the chosen URL.
    const pickerUrl = `/admin/media?picker=1&field=${encodeURIComponent(field)}`;
    const popup = window.open(pickerUrl, "dune-media-picker", "width=900,height=600");
    if (!popup) return;

    const onMessage = async (event: MessageEvent) => {
      // Only trust messages from the picker window we opened, and only from
      // our own origin — the media picker is same-origin, so a message from
      // any other origin is not ours.
      if (event.origin !== window.location.origin) return;
      if (event.source !== popup) return;
      if (!event.data || event.data.type !== "dune:media-selected") return;
      window.removeEventListener("message", onMessage);
      popup.close();

      const url: string = event.data.url;
      setStatus("saving");
      try {
        const encodedPath = encodeURIComponent(sourcePath);
        const res = await fetch(`/admin/api/content/${encodedPath}/fields`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ fields: { [field]: url } }),
        });
        setStatus(res.ok ? "saved" : "error");
        if (res.ok) setTimeout(() => setStatus("idle"), 1500);
      } catch {
        setStatus("error");
      }
    };
    window.addEventListener("message", onMessage);
  }, [field, sourcePath]);

  return h(
    "span",
    {
      style: { position: "relative", display: "inline-block" },
      "data-dune-field": field,
      "data-dune-source": sourcePath,
    },
    children,
    h(
      "button",
      {
        class: "dune-edit-handle dune-edit-handle--image",
        title: `Change ${field}`,
        onClick: openPicker,
        style: {
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          background: "rgba(0,0,0,0.35)",
          color: "#fff",
          border: "2px solid #3498db",
          borderRadius: "4px",
          cursor: "pointer",
          opacity: 0,
          transition: "opacity 0.15s",
          fontSize: "13px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        },
      },
      status === "saving" ? "Saving…" : "📷 Change image",
    ),
    status !== "idle" && h(
      "span",
      {
        style: {
          position: "absolute",
          bottom: "4px",
          right: "4px",
          background: status === "error" ? "#e74c3c" : "#2ecc71",
          color: "#fff",
          borderRadius: "2px",
          padding: "1px 6px",
          fontSize: "11px",
        },
      },
      status === "saved" ? "Saved" : "Error",
    ),
  );
}
