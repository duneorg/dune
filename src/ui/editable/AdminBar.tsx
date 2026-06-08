/** @jsxImportSource preact */
/**
 * `<AdminBar>` — persistent thin admin bar injected at the top of every page
 * during an active admin session.
 *
 * Shows: page title, edit/preview toggle, save status, and an "Open in admin"
 * escape hatch link to the full admin editor.
 *
 * This component is *not* intended for direct use in templates.  It is
 * injected by the engine's admin-mode HTML injection when an admin session
 * cookie is present.  Templates may render it explicitly if they prefer to
 * control its position.
 *
 * @example
 * ```tsx
 * // Explicit use (optional — normally injected automatically):
 * import { AdminBar } from "@dune/core/ui/editable";
 * <AdminBar sourcePath={page.sourcePath} pageTitle={page.frontmatter.title} />
 * ```
 */

import { h } from "preact";
import type { JSX } from "preact";
import { useState, useCallback, useEffect } from "preact/hooks";

/** Props for {@link AdminBar}. */
export interface AdminBarProps {
  /** Source path of the currently viewed content file. */
  sourcePath: string;
  /** Page title shown in the bar. */
  pageTitle?: string;
  /** Admin panel prefix (default "/admin"). */
  adminPrefix?: string;
}

type BarMode = "preview" | "edit";
type SaveStatus = "idle" | "saving" | "saved" | "error";

export default function AdminBar({
  sourcePath,
  pageTitle,
  adminPrefix = "/admin",
}: AdminBarProps): JSX.Element {
  const [mode, setMode] = useState<BarMode>("edit");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");

  // Broadcast edit mode changes to all <Editable*> components on the page.
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__DUNE_EDIT_MODE__ = mode === "edit";
    // Dispatch a custom event so islands can react without polling.
    window.dispatchEvent(new CustomEvent("dune:edit-mode-change", { detail: { mode } }));
  }, [mode]);

  const handleSave = useCallback(async () => {
    setSaveStatus("saving");
    try {
      const encodedPath = encodeURIComponent(sourcePath);
      const res = await fetch(`${adminPrefix}/api/content/${encodedPath}/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: "{}",
      });
      setSaveStatus(res.ok ? "saved" : "error");
      if (res.ok) setTimeout(() => setSaveStatus("idle"), 2000);
    } catch {
      setSaveStatus("error");
    }
  }, [sourcePath, adminPrefix]);

  const adminUrl = `${adminPrefix}/pages/${encodeURIComponent(sourcePath)}`;

  return h(
    "div",
    {
      id: "dune-admin-bar",
      style: {
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        height: "40px",
        background: "#1a1a2e",
        color: "#fff",
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "0 16px",
        zIndex: 99999,
        fontSize: "13px",
        fontFamily: "system-ui, sans-serif",
        boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
      },
    },

    // Dune logo / brand
    h("span", {
      style: { fontWeight: 700, letterSpacing: "0.05em", color: "#e2b96f", marginRight: "4px" },
    }, "✦ DUNE"),

    // Page title (truncated)
    h("span", {
      style: {
        flex: 1,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        opacity: 0.75,
        maxWidth: "300px",
      },
    }, pageTitle ?? sourcePath),

    // Edit / Preview toggle
    h(
      "button",
      {
        onClick: () => setMode((m) => m === "edit" ? "preview" : "edit"),
        style: {
          background: mode === "edit" ? "#3498db" : "rgba(255,255,255,0.15)",
          color: "#fff",
          border: "1px solid rgba(255,255,255,0.2)",
          borderRadius: "4px",
          padding: "3px 12px",
          cursor: "pointer",
          fontSize: "12px",
        },
      },
      mode === "edit" ? "✎ Editing" : "👁 Preview",
    ),

    // Save button (only in edit mode)
    mode === "edit" && h(
      "button",
      {
        onClick: handleSave,
        disabled: saveStatus === "saving",
        style: {
          background: saveStatus === "saved" ? "#2ecc71" : saveStatus === "error" ? "#e74c3c" : "#27ae60",
          color: "#fff",
          border: "none",
          borderRadius: "4px",
          padding: "3px 14px",
          cursor: saveStatus === "saving" ? "default" : "pointer",
          fontSize: "12px",
        },
      },
      saveStatus === "saving" ? "Saving…"
        : saveStatus === "saved" ? "Saved ✓"
        : saveStatus === "error" ? "Error ✗"
        : "Save",
    ),

    // Open in admin link
    h(
      "a",
      {
        href: adminUrl,
        style: {
          color: "rgba(255,255,255,0.6)",
          textDecoration: "none",
          fontSize: "12px",
          marginLeft: "auto",
        },
        title: "Open full admin editor",
      },
      "Open in admin →",
    ),
  );
}
